"""
TTS 语音合成 API 端点
提供文本转语音接口, 调用火山引擎 seed-tts-2.0 大模型
配置通过设置页面管理, 支持即时生效
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from app.api.deps import get_current_user
from app.models.user import User
from app.services.tts_service import synthesize_tts
from app.services.config_service import get_config_value
from loguru import logger

router = APIRouter(prefix="/tts", tags=["TTS 语音合成"])


class TTSRequest(BaseModel):
    """
    TTS 合成请求体
    text: 待合成的文本 (必填, 上限 500 字符)
    voice: 音色 ID (可选, 默认使用配置中的 tts_voice)
    speed: 语速 (可选, 0.5 ~ 2.0, 默认 1.0)
    """
    text: str = Field(
        ...,
        min_length=1,
        max_length=3000,
        description="待合成的文本, 上限 3000 字符",
    )
    voice: str | None = Field(
        None,
        description="音色 ID, 为 None 时使用默认音色",
    )
    speed: float | None = Field(
        None,
        ge=0.5,
        le=2.0,
        description="语速倍率 (0.5 ~ 2.0), 默认 1.0",
    )


@router.post(
    "/synthesize",
    summary="文本转语音合成",
    description="将中文文本合成为 MP3 音频并返回。使用火山引擎 seed-tts-2.0 大模型, 支持多种音色和语速调节。",
)
async def tts_synthesize(
    req: TTSRequest,
    current_user: User = Depends(get_current_user),
) -> bytes:
    """
    文本转语音合成端点

    接收文本和可选参数, 返回 MP3 音频数据 (audio/mpeg)。
    需要用户认证以控制 API 调用成本。

    :param req: TTS 合成请求体
    :param current_user: 当前登录用户
    :return: MP3 音频 bytes
    """
    # 检查 TTS API Key 是否已配置
    tts_api_key = get_config_value("tts_api_key")
    if not tts_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TTS 服务未配置, 请在系统设置页面填写火山引擎 API Key",
        )

    logger.info(
        f"TTS 合成请求: user={current_user.email}, "
        f"text_len={len(req.text)}, voice={req.voice or get_config_value('tts_voice')}"
    )

    # 调用 TTS 服务
    audio_bytes = await synthesize_tts(
        text=req.text,
        voice=req.voice,
        speed=req.speed,
    )

    if audio_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="TTS 合成失败, 请检查火山引擎凭证配置和网络连接",
        )

    # 返回 MP3 音频
    from fastapi.responses import Response
    return Response(
        content=audio_bytes,
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": "inline; filename=tts.mp3",
            "Cache-Control": "no-cache",
        },
    )
