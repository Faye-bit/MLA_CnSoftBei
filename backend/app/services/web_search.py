"""
共享网络搜索服务
提供博查 Search API 的公共调用接口，供蔡丰（资源采集师）和 AI 问答对话复用

功能:
- search_web(): 调用博查 API 执行网络搜索，支持优雅降级
- detect_source_platform(): 根据 URL 域名识别内容来源平台
- build_chat_search_query(): 将用户对话问题优化为搜索引擎友好的查询字符串
"""

import httpx
from app.services.config_service import get_config_value
from loguru import logger


# ============================================================================
# 平台识别
# ============================================================================

# 中文主流知识分享平台域名映射
PLATFORM_DOMAINS: dict[str, str] = {
    "zhihu.com": "知乎",
    "zhuanlan.zhihu.com": "知乎专栏",
    "bilibili.com": "B站",
    "b23.tv": "B站",
    "xiaohongshu.com": "小红书",
    "xhslink.com": "小红书",
    "csdn.net": "CSDN",
    "blog.csdn.net": "CSDN",
    "juejin.cn": "掘金",
    "segmentfault.com": "思否",
    "jianshu.com": "简书",
    "cnblogs.com": "博客园",
    "weixin.qq.com": "微信公众号",
    "mp.weixin.qq.com": "微信公众号",
    "developer.mozilla.org": "MDN",
    "wikipedia.org": "维基百科",
    "zh.wikibooks.org": "维基教科书",
    "runoob.com": "菜鸟教程",
    "liaoxuefeng.com": "廖雪峰",
    "github.com": "GitHub",
    "gitee.com": "码云",
    "stackoverflow.com": "Stack Overflow",
    "medium.com": "Medium",
}


def detect_source_platform(url: str) -> str:
    """
    根据 URL 域名识别内容来源平台名称

    遍历 PLATFORM_DOMAINS，匹配 URL 中包含的域名关键字。
    匹配规则: 域名关键字出现在 URL 中即视为匹配。

    :param url: 目标 URL
    :return: 平台中文名称，未识别时返回 "网页"
    """
    if not url:
        return "网页"

    url_lower = url.lower()
    for domain, platform_name in PLATFORM_DOMAINS.items():
        if domain in url_lower:
            return platform_name
    return "网页"


# ============================================================================
# 搜索查询构建 (Chat 专用)
# ============================================================================

def build_chat_search_query(user_message: str) -> str:
    """
    将用户的对话问题转换为搜索引擎友好的查询字符串

    策略:
    - 直接使用用户的原始问题作为搜索查询
    - 如果问题过长（>100 字符），取前 100 字符
    - 不附加平台限定词，让搜索引擎自然返回最相关的结果
      （平台偏好由 LLM 在总结时处理 + 前端展示时用 detect_source_platform 标注）

    :param user_message: 用户在对话中发送的问题
    :return: 适合搜索引擎的查询字符串
    """
    query = user_message.strip()
    if len(query) > 100:
        # 截断过长问题，保留完整的句子边界
        truncated = query[:100]
        # 尝试在最后一个标点处截断
        for sep in ["？", "?", "。", ".", "！", "!", "，", ",", " ", "\n"]:
            last_idx = truncated.rfind(sep)
            if last_idx > 30:  # 至少保留 30 个字符
                query = truncated[:last_idx]
                break
        else:
            query = truncated
    return query


# ============================================================================
# 网络搜索核心实现
# ============================================================================

async def search_web(query: str, count: int = 10) -> list[dict]:
    """
    调用博查 Search API 执行网络搜索

    使用博查 Web Search API (POST + Bearer Token 鉴权):
      POST {search_api_base}
      Authorization: Bearer <API_KEY>
      Body: {"query": "...", "freshness": "noLimit", "summary": True, "count": N}

    如果未配置 API Key 或请求失败，返回空列表（优雅降级）

    返回的每条结果包含:
    - title: 网页标题
    - url: 网页链接
    - content: 摘要/片段 (最多 300 字符)
    - source_platform: 来源平台中文名 (通过 detect_source_platform 识别)
    - favicon: 网站图标 URL (若 API 返回)
    - image: 封面图片 URL (若 API 返回)

    :param query: 搜索关键词
    :param count: 期望返回的结果数量 (默认 10)
    :return: 搜索结果列表 [{title, url, content, source_platform, favicon?, image?}]
    """
    # 读取搜索 API 配置
    search_api_base = get_config_value("search_api_base")
    search_api_key = get_config_value("search_api_key")

    if not search_api_base or not search_api_key:
        logger.info(
            f"网络搜索: API 未配置 "
            f"(base={'已配置' if search_api_base else '未配置'}, "
            f"key={'已配置' if search_api_key else '未配置'}), "
            f"跳过搜索"
        )
        return []

    logger.info(f"网络搜索: query='{query[:80]}...' count={count}")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                search_api_base,
                json={
                    "query": query,
                    "freshness": "noLimit",
                    "summary": True,
                    "count": count,
                },
                headers={
                    "Authorization": f"Bearer {search_api_key}",
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()

            logger.info(
                f"网络搜索: API 响应 code={data.get('code')}, "
                f"total={data.get('data', {}).get('total_results', 'N/A')}"
            )

            # 标准化结果格式 (兼容博查和其他搜索引擎的返回格式)
            web_pages = (
                data.get("data", {}).get("pages", None)
                or data.get("data", {}).get("webPages", None)
                or data.get("results", None)
                or data.get("data", None)
                or []
            )
            # 如果 data.data 是列表 (某些 API 直接返回数组)
            if isinstance(web_pages, dict):
                web_pages = web_pages.get("value", []) if "value" in web_pages else []

            if not isinstance(web_pages, list):
                logger.warning(f"网络搜索: 结果格式异常, 无法解析: {type(data)}")
                return []

            results = []
            for item in web_pages:
                if not isinstance(item, dict):
                    continue

                url = item.get("url", item.get("link", item.get("displayUrl", "")))
                result = {
                    "title": item.get("title", item.get("name", "")),
                    "url": url,
                    "content": (
                        item.get("content", item.get("snippet", item.get("summary", "")))
                    )[:300],
                    "source_platform": detect_source_platform(url),
                }

                # 额外提取封面/图标信息 (若 API 返回)
                favicon = item.get("favicon", item.get("icon", item.get("siteIcon", "")))
                if favicon:
                    result["favicon"] = favicon

                image = item.get("image", item.get("thumbnail", item.get("snapshot", "")))
                if image:
                    result["image"] = image

                results.append(result)

            logger.info(f"网络搜索: 完成, 获取 {len(results)} 条结果")
            return results

    except httpx.TimeoutException:
        logger.warning("网络搜索: API 超时 (15s)")
        return []
    except httpx.HTTPStatusError as e:
        logger.warning(
            f"网络搜索: API HTTP 错误 "
            f"status={e.response.status_code} body={e.response.text[:200]}"
        )
        return []
    except Exception as e:
        logger.warning(f"网络搜索: API 异常: {type(e).__name__}: {e}")
        return []
