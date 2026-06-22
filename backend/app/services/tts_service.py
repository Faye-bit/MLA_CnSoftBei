"""
TTS 语音合成服务
使用火山引擎 seed-tts-2.0 HTTP API
支持两种认证方式: 新版 API Key / 旧版 App ID + Access Token
支持音色别名映射 (如 zh-female-warm → zh_female_vv_uranus_bigtts)

API 返回格式: 流式 JSON 行
  每行: {"code":0,"message":"","data":"<base64>"}
  结束行: {"code":20000000,"message":"OK","data":null}
"""

import json
import base64
import uuid
from pathlib import Path
from app.core.config import settings
from app.services.config_service import get_config_value
from loguru import logger

# 火山引擎 TTS API 端点 (HTTP 单向流式)
_TTS_API_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional"

# TTS 临时音频输出目录
_TTS_OUTPUT_DIR = Path(settings.upload_dir) / "tts_cache"

# ============================================================================
# 音色别名映射
# ============================================================================
_VOICE_ALIAS_MAP: dict[str, str] = {
    "zh-female-warm":      "zh_female_vv_uranus_bigtts",
    "zh-female-reporter":  "zh_female_shuangkuaisisi_moon_bigtts",
    "zh-male-warm":        "zh_male_yuanboxiaoshu_moon_bigtts",
    "zh-male-energetic":   "zh_male_jieshuonansheng_mars_bigtts",
    "en-female-assistant": "en_female_anna_mars_bigtts",
    "en-male-assistant":   "en_male_adam_mars_bigtts",
    "zh_female_warm":      "zh_female_vv_uranus_bigtts",
    "zh_female_reporter":  "zh_female_shuangkuaisisi_moon_bigtts",
    "zh_male_warm":        "zh_male_yuanboxiaoshu_moon_bigtts",
    "zh_male_energetic":   "zh_male_jieshuonansheng_mars_bigtts",
}


def _resolve_speaker(voice: str) -> str:
    """ 音色别名 → 原生 speaker ID """
    return _VOICE_ALIAS_MAP.get(voice.lower(), voice)


def _ensure_output_dir() -> None:
    _TTS_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _build_request_body(text: str, voice: str, speed: float) -> dict:
    """ 构建火山引擎 TTS HTTP API 请求体 """
    speech_rate = round((speed - 1.0) * 100)
    speaker_id = _resolve_speaker(voice)
    return {
        "user": {"uid": "mla-tts-user"},
        "req_params": {
            "text": text,
            "speaker": speaker_id,
            "audio_params": {
                "format": "mp3",
                "sample_rate": 24000,
                "speech_rate": speech_rate,
            },
        },
    }


def _parse_streaming_response(response_text: str) -> bytes | None:
    """
    解析火山引擎 TTS API 流式 JSON 响应, 提取并拼接 base64 音频数据

    响应格式 (每行一条 JSON):
      {"code":0,"message":"","data":"<base64 mp3 chunk>"}
      ...
      {"code":20000000,"message":"OK","data":null}
    """
    audio_chunks: list[bytes] = []
    lines = response_text.strip().split("\n")

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            logger.warning(f"TTS API 返回非 JSON 行: {line[:100]}")
            continue

        code = obj.get("code", -1)
        data = obj.get("data")

        # 正常数据块
        if code == 0 and data:
            try:
                chunk = base64.b64decode(data)
                audio_chunks.append(chunk)
            except Exception as e:
                logger.warning(f"TTS API base64 解码失败: {e}")
                continue

        # 结束标记
        elif code == 20000000:
            break

        # 错误
        elif code != 0:
            logger.warning(f"TTS API 返回错误码 {code}: {obj.get('message', '')}")
            return None

    if not audio_chunks:
        logger.warning("TTS API 未返回任何音频数据")
        return None

    return b"".join(audio_chunks)


async def _synthesize_http(
    text: str,
    voice: str,
    speed: float,
    output_path: str,
) -> bool:
    """
    通过 HTTP POST 调用火山引擎 TTS API, 解析流式 JSON 响应并拼装 MP3
    自动选择认证方式: 优先新版 API Key, 其次旧版 App ID + Access Token
    """
    try:
        import httpx
    except ImportError:
        logger.error("httpx 库未安装, 无法调用 TTS API")
        return False

    tts_api_key = get_config_value("tts_api_key")
    tts_app_id = get_config_value("tts_app_id")
    tts_access_token = get_config_value("tts_access_token")

    body = _build_request_body(text, voice, speed)

    # 构建认证方案列表
    auth_attempts: list[tuple[str, dict[str, str]]] = []
    if tts_api_key:
        auth_attempts.append((
            "API Key",
            {
                "X-Api-Key": tts_api_key,
                "X-Api-Resource-Id": "seed-tts-2.0",
                "Content-Type": "application/json",
            },
        ))
    if tts_app_id and tts_access_token:
        auth_attempts.append((
            "App ID + Token",
            {
                "X-Api-App-Key": tts_app_id,
                "X-Api-Access-Key": tts_access_token,
                "X-Api-Resource-Id": "seed-tts-2.0",
                "Content-Type": "application/json",
            },
        ))

    if not auth_attempts:
        logger.warning("TTS 凭证未配置")
        return False

    async with httpx.AsyncClient(timeout=30.0) as client:
        for auth_name, headers in auth_attempts:
            try:
                response = await client.post(
                    _TTS_API_URL,
                    json=body,
                    headers=headers,
                )

                if response.status_code != 200:
                    logger.warning(
                        f"TTS API ({auth_name}) HTTP {response.status_code}: "
                        f"{response.text[:300]}"
                    )
                    continue

                # 解析流式 JSON 响应, 提取并拼接 base64 音频
                audio_data = _parse_streaming_response(response.text)

                if audio_data is None or len(audio_data) == 0:
                    logger.warning(f"TTS API ({auth_name}) 解析后无有效音频数据")
                    continue

                with open(output_path, "wb") as f:
                    f.write(audio_data)

                logger.info(
                    f"TTS 合成成功 ({auth_name}): {len(text)} 字符 → "
                    f"{len(audio_data)} bytes"
                )
                return True

            except httpx.TimeoutException:
                logger.warning(f"TTS API ({auth_name}) 请求超时")
                continue
            except Exception as e:
                logger.warning(f"TTS API ({auth_name}) 异常: {type(e).__name__}: {e}")
                continue

    logger.error("所有 TTS 认证方案均失败")
    return False


async def synthesize_tts(
    text: str,
    voice: str | None = None,
    speed: float | None = None,
) -> bytes | None:
    """
    异步 TTS 合成: 将文本合成为 MP3 音频并返回 bytes
    :param text: 待合成的文本 (建议 < 500 字)
    :param voice: 音色, 支持别名 (zh-female-warm) 或原生 ID
    :param speed: 语速 (0.5 ~ 2.0)
    :return: MP3 音频 bytes, 失败返回 None
    """
    text = text.strip()
    if not text:
        return None

    # 填充默认参数
    if voice is None:
        voice = get_config_value("tts_voice") or settings.tts_voice
    if speed is None:
        speed_str = get_config_value("tts_speed")
        try:
            speed = float(speed_str) if speed_str else settings.tts_speed
        except (ValueError, TypeError):
            speed = settings.tts_speed

    # 生成输出路径
    _ensure_output_dir()
    file_name = f"tts_{uuid.uuid4().hex[:12]}.mp3"
    output_path = str(_TTS_OUTPUT_DIR / file_name)

    # 调用 API
    success = await _synthesize_http(text, voice, speed, output_path)

    if not success:
        return None

    # 读取文件
    try:
        with open(output_path, "rb") as f:
            audio_bytes = f.read()

        if len(audio_bytes) == 0:
            logger.error("TTS 输出文件为空")
            return None

        logger.info(
            f"TTS 完成: {len(text)} 字符 → {len(audio_bytes)} bytes, "
            f"voice={_resolve_speaker(voice)}, speed={speed}"
        )
        return audio_bytes
    except FileNotFoundError:
        logger.error(f"TTS 输出文件不存在: {output_path}")
        return None
    finally:
        # 清理临时文件
        try:
            import os
            os.remove(output_path)
        except OSError:
            pass
