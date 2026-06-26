"""
页面级文档解析服务
负责 PDF/PPTX 文档的页面渲染、LLM 知识点提取、嵌入文本构造

核心流程:
  1. 将 PDF/PPTX 逐页渲染为 PNG 图片
  2. (可选) 逐页调用多模态 LLM 提取知识点
  3. 构造用于向量嵌入的文本
"""

import os
import asyncio
import base64
import uuid
from typing import List, Optional
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from openai import AsyncOpenAI
from app.core.config import settings

# Poppler 工具路径 (pdf2image 底层依赖, 用于 PDF 渲染为图片)
_POPPLER_PATH = None


def _get_poppler_path() -> str | None:
    """
    自动检测 poppler 工具路径
    优先级: settings.poppler_path > 环境变量 POPPLER_PATH > 常见安装位置 > 系统 PATH
    :return: poppler bin 目录路径, 找不到返回空字符串
    """
    global _POPPLER_PATH
    if _POPPLER_PATH is not None:
        return _POPPLER_PATH if _POPPLER_PATH else None

    # 判断 pdftoppm 可执行文件是否存在
    def _check_bin(path: str) -> bool:
        exe = "pdftoppm.exe" if os.name == "nt" else "pdftoppm"
        return os.path.exists(os.path.join(path, exe))

    # 1. 应用配置 (settings.poppler_path)
    if settings.poppler_path and _check_bin(settings.poppler_path):
        _POPPLER_PATH = settings.poppler_path
        return settings.poppler_path

    # 2. 环境变量
    env_path = os.environ.get("POPPLER_PATH", "")
    if env_path and _check_bin(env_path):
        _POPPLER_PATH = env_path
        return env_path

    # 3. 常见安装位置 (跨平台)
    candidates: list[str] = []
    if os.name == "nt":
        candidates = [
            "D:/Poppler/poppler-24.08.0/Library/bin",
            "C:/Poppler/bin",
            "C:/Program Files/poppler/bin",
            "E:/poppler/bin",
        ]
    else:
        # macOS/Linux: homebrew / apt 安装后 pdftoppm 直接在 PATH 中
        import shutil
        if shutil.which("pdftoppm"):
            _POPPLER_PATH = ""
            return ""
    for candidate in candidates:
        if _check_bin(candidate):
            _POPPLER_PATH = candidate
            return candidate

    # 4. 系统 PATH (最后尝试)
    _POPPLER_PATH = ""
    return ""


# ==================== 页面渲染 ====================

def render_pages(
    file_path: str,
    file_type: str,
    doc_id: uuid.UUID,
    upload_dir: str,
    dpi: int = 200,
) -> List[str]:
    """
    将文档逐页渲染为 PNG 图片, 保存到 uploads/{doc_id}/pages/ 目录

    处理策略:
      - PDF: 直接使用 pdf2image (poppler) 渲染
      - PPTX: 先通过 LibreOffice 转为 PDF, 再用 pdf2image 渲染
      - 其他类型: 抛出 ValueError

    :param file_path: 源文件路径
    :param file_type: 文件类型 (pdf / pptx)
    :param doc_id: 文档 ID, 用于创建输出目录
    :param upload_dir: 上传根目录
    :param dpi: 渲染分辨率, 默认 200 DPI
    :return: 保存的图片路径列表 (按页码顺序)
    """
    file_type_lower = file_type.lower()

    # 创建页面图片输出目录
    pages_dir = os.path.join(upload_dir, str(doc_id), "pages")
    os.makedirs(pages_dir, exist_ok=True)

    if file_type_lower == "pdf":
        return _render_pdf_pages(file_path, pages_dir, dpi)
    elif file_type_lower == "pptx":
        return _render_pptx_pages(file_path, pages_dir, dpi, upload_dir, doc_id)
    else:
        raise ValueError(f"不支持页面渲染的文件类型: {file_type}")


def _render_pdf_pages(file_path: str, pages_dir: str, dpi: int) -> List[str]:
    """
    使用 pdf2image 将 PDF 逐页渲染为 PNG

    :param file_path: PDF 文件路径
    :param pages_dir: 输出目录
    :param dpi: 渲染 DPI
    :return: 图片路径列表
    """
    from pdf2image import convert_from_path

    poppler_path = _get_poppler_path()
    if poppler_path:
        logger.info(f"使用 poppler 路径: {poppler_path}")
    else:
        logger.info("poppler 路径为空, 依赖系统 PATH")

    logger.info(f"开始渲染 PDF 页面: {file_path}, DPI={dpi}")

    # 逐页转换为 PIL Image 列表
    if poppler_path:
        images = convert_from_path(file_path, dpi=dpi, poppler_path=poppler_path)
    else:
        images = convert_from_path(file_path, dpi=dpi)

    saved_paths: List[str] = []
    for i, img in enumerate(images, start=1):
        output_path = os.path.join(pages_dir, f"page_{i}.png")
        img.save(output_path, "PNG")
        saved_paths.append(output_path)
        logger.debug(f"PDF 第 {i}/{len(images)} 页已渲染: {output_path}")

    logger.info(f"PDF 页面渲染完成: 共 {len(saved_paths)} 页")
    return saved_paths


def _render_pptx_pages(
    file_path: str,
    pages_dir: str,
    dpi: int,
    upload_dir: str,
    doc_id: uuid.UUID,
) -> List[str]:
    """
    将 PPTX 先转为 PDF (通过 LibreOffice), 再渲染为 PNG

    如果 LibreOffice 不可用, 抛出 RuntimeError

    :param file_path: PPTX 文件路径
    :param pages_dir: 输出目录
    :param dpi: 渲染 DPI
    :param upload_dir: 上传根目录 (用于存放中间 PDF)
    :param doc_id: 文档 ID
    :return: 图片路径列表
    """
    import subprocess
    import shutil

    # 检查 LibreOffice 是否可用
    if not shutil.which("soffice") and not shutil.which("libreoffice"):
        raise RuntimeError(
            "PPTX 页面渲染需要 LibreOffice。"
            "请运行: brew install libreoffice (macOS) 或 apt-get install libreoffice-impress (Linux)"
        )

    # 中间 PDF 输出目录
    pdf_dir = os.path.join(upload_dir, str(doc_id), "temp_pdf")
    os.makedirs(pdf_dir, exist_ok=True)

    libreoffice_bin = shutil.which("soffice") or shutil.which("libreoffice")

    # 使用 LibreOffice 将 PPTX 转为 PDF
    logger.info(f"使用 LibreOffice 将 PPTX 转为 PDF: {file_path}")
    result = subprocess.run(
        [
            libreoffice_bin,
            "--headless",
            "--convert-to", "pdf",
            "--outdir", pdf_dir,
            file_path,
        ],
        capture_output=True,
        text=True,
        timeout=120,  # 2 分钟超时
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"LibreOffice PPTX→PDF 转换失败: {result.stderr[:500]}"
        )

    # 查找生成的 PDF 文件
    pdf_files = [f for f in os.listdir(pdf_dir) if f.endswith(".pdf")]
    if not pdf_files:
        raise RuntimeError("LibreOffice 转换完成但未找到输出 PDF 文件")

    pdf_path = os.path.join(pdf_dir, pdf_files[0])
    logger.info(f"PPTX → PDF 转换完成: {pdf_path}")

    # 用 pdf2image 渲染 PDF 页面
    image_paths = _render_pdf_pages(pdf_path, pages_dir, dpi)

    # 清理中间 PDF 目录
    try:
        import shutil as _shutil
        _shutil.rmtree(pdf_dir)
    except Exception as e:
        logger.warning(f"清理临时 PDF 目录失败: {e}")

    return image_paths


# ==================== LLM 知识点提取 ====================

# System Prompt: 指导 LLM 提取知识点
PAGE_EXTRACTION_SYSTEM_PROMPT = """你是一个专业的课程知识图谱构建助手。请仔细查看这张文档页面的图片，完成以下任务：

1. **页面摘要** (summary)：用一句话概括本页的主要内容，不超过 80 字。
   - 如果是纯文字页，概述核心概念和结论
   - 如果包含图表，说明图表展示的数据或关系
   - 如果是标题页/目录页/空白页，如实说明

2. **知识点提取** (knowledge_points)：识别本页包含的知识点。
   每个知识点需要：
   - title: 知识点名称，简洁准确，不超过 10 字
   - description: 一句话解释，不超过 50 字
   - difficulty: easy（基础概念）/ medium（需要理解的）/ hard（复杂推导）

   要求：
   - 只提取本页明确涉及的知识点，不要编造
   - 如果本页不包含明确的知识点（如目录页、标题页），返回空列表
   - 请自行判断应提取多少个知识点，不要遗漏

输出格式：严格的 JSON，不要包含任何解释文字，不要使用 markdown 代码块包裹：
{
  "summary": "页面内容摘要",
  "knowledge_points": [
    {"title": "知识点名", "description": "一句话描述", "difficulty": "medium"}
  ]
}"""


async def _extract_single_page(
    page_num: int,
    image_path: str,
    api_key: str,
    api_base: str,
    model: str,
    course_name: str = "",
) -> dict:
    """
    调用多模态 LLM 提取单页的知识点

    :param page_num: 页码 (从 1 开始)
    :param image_path: 页面 PNG 图片路径
    :param api_key: LLM API Key
    :param api_base: LLM API 地址
    :param model: 模型名称
    :param course_name: 课程名称 (可选, 提供上下文)
    :return: {"summary": str, "knowledge_points": list}
    """
    import json

    # 读取图片并转为 base64
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode("utf-8")

    # 根据图片扩展名确定 MIME 类型
    mime_type = "image/png"

    client = AsyncOpenAI(api_key=api_key, base_url=api_base)

    # 构建 user message
    user_message = f"请分析以上文档的第 {page_num} 页。"
    if course_name:
        user_message += f"\n课程名称：{course_name}"

    try:
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": PAGE_EXTRACTION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_message},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{image_data}",
                                "detail": "high",
                            },
                        },
                    ],
                },
            ],
            temperature=0.3,
            max_tokens=2000,
            timeout=60.0,
        )

        raw_content = response.choices[0].message.content or ""

        # 解析 JSON 响应 — 健壮处理可能的 markdown 包裹
        result = _parse_llm_json(raw_content)

        # 验证必要字段
        if "summary" not in result:
            result["summary"] = f"第 {page_num} 页"
        if "knowledge_points" not in result:
            result["knowledge_points"] = []

        # 验证 knowledge_points 结构
        valid_kps = []
        for kp in result.get("knowledge_points", []):
            if isinstance(kp, dict) and "title" in kp:
                valid_kps.append({
                    "title": str(kp.get("title", ""))[:50],
                    "description": str(kp.get("description", ""))[:200],
                    "difficulty": kp.get("difficulty", "medium") if kp.get("difficulty") in ("easy", "medium", "hard") else "medium",
                })
        result["knowledge_points"] = valid_kps

        logger.info(
            f"第 {page_num} 页 LLM 解析完成: "
            f"summary={result.get('summary', '')[:30]}..., "
            f"kps={len(valid_kps)}"
        )
        return result

    except Exception as e:
        logger.error(f"第 {page_num} 页 LLM 解析失败: {e}")
        # 降级: 无知识点, summary 用占位文本
        return {
            "summary": f"[第 {page_num} 页 - 解析失败, 请手动查看]",
            "knowledge_points": [],
        }


def _parse_llm_json(raw: str) -> dict:
    """
    健壮的 JSON 解析, 处理 LLM 可能返回的 markdown 代码块包裹

    :param raw: LLM 原始响应文本
    :return: 解析后的字典
    """
    import json
    import re

    if not raw or not raw.strip():
        return {}

    text = raw.strip()

    # 尝试提取 ```json ... ``` 或 ``` ... ``` 包裹的内容
    code_block_match = re.search(r"```(?:json)?\s*\n?(.*?)\n?```", text, re.DOTALL)
    if code_block_match:
        text = code_block_match.group(1).strip()

    # 尝试提取第一个 { ... } 结构
    brace_match = re.search(r"\{.*\}", text, re.DOTALL)
    if brace_match:
        text = brace_match.group(0)

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.warning(f"LLM JSON 解析失败, 原始内容: {raw[:200]}")
        return {}


async def extract_pages_via_llm(
    pages: List,  # List[DocumentPage]
    api_key: str,
    api_base: str,
    model: str,
    course_name: str = "",
    max_concurrency: int = 3,
) -> None:
    """
    并发调用多模态 LLM 提取每页的知识点

    使用 asyncio.Semaphore 控制并发数, 避免 API 限流
    单页失败不影响其他页, 降级为占位 summary

    :param pages: DocumentPage 对象列表 (已保存到数据库, 有 id)
    :param api_key: LLM API Key
    :param api_base: LLM API 地址
    :param model: 模型名称
    :param course_name: 课程名称 (可选)
    :param max_concurrency: 最大并发数, 默认 3
    """
    semaphore = asyncio.Semaphore(max_concurrency)

    async def process_one(page) -> None:
        """处理单个页面: 调用 LLM 并更新 extracted_kps 和 summary"""
        async with semaphore:
            logger.info(f"开始 LLM 提取第 {page.page_number} 页...")
            result = await _extract_single_page(
                page_num=page.page_number,
                image_path=page.image_path,
                api_key=api_key,
                api_base=api_base,
                model=model,
                course_name=course_name,
            )
            # 原地更新页面对象 (调用方负责 commit)
            page.summary = result.get("summary", "")
            page.extracted_kps = result.get("knowledge_points", [])

    # 并发处理所有页面
    tasks = [process_one(page) for page in pages]
    await asyncio.gather(*tasks)

    total_kps = sum(len(p.extracted_kps or []) for p in pages)
    logger.info(f"LLM 页面提取全部完成: {len(pages)} 页, 共提取 {total_kps} 个知识点")


# ==================== 嵌入文本构造 ====================

def build_page_embedding_text(page) -> str:
    """
    构造用于向量嵌入的文本
    将页面的摘要和所有知识点拼接为一个字符串
    嵌入到 Chroma 时关联 DocumentPage 的 ID

    :param page: DocumentPage 对象 (需有 summary 和 extracted_kps 属性)
    :return: 嵌入用文本
    """
    parts = []

    # 页面摘要 (提供内容级别的语义锚点)
    if page.summary:
        parts.append(page.summary)

    # 每个知识点的标题和描述
    for kp in (page.extracted_kps or []):
        if isinstance(kp, dict):
            kp_text = f"{kp.get('title', '')}: {kp.get('description', '')}"
        else:
            kp_text = str(kp)
        parts.append(kp_text)

    return " ".join(parts)


# ==================== 页面图片保存工具 ====================

def save_page_image(
    image,  # PIL Image
    doc_id: uuid.UUID,
    page_number: int,
    upload_dir: str,
) -> str:
    """
    保存单页图片到磁盘

    :param image: PIL Image 对象
    :param doc_id: 文档 ID
    :param page_number: 页码
    :param upload_dir: 上传根目录
    :return: 保存的图片路径
    """
    pages_dir = os.path.join(upload_dir, str(doc_id), "pages")
    os.makedirs(pages_dir, exist_ok=True)

    output_path = os.path.join(pages_dir, f"page_{page_number}.png")
    image.save(output_path, "PNG")
    return output_path
