"""
ORM 模型注册
导入所有模型类以确保 Base.metadata 包含完整的表信息
"""

from app.core.database import Base
from app.models.user import User
from app.models.course import Course, Chapter, KnowledgePoint
from app.models.document import Document, DocumentChunk
from app.models.document_page import DocumentPage, PageKnowledgePoint
from app.models.config import SystemConfig
from app.models.email_verification import EmailVerification
from app.models.audit_log import AuditLog
from app.models.conversation import Conversation, Message
from app.models.profile import StudentProfile
from app.models.learning import LearningSession, LearningStage, GeneratedResource, AgentTask

# 所有模型列表, 供 alembic 和 init_db 使用
__all__ = [
    "Base",
    "User",
    "Course",
    "Chapter",
    "KnowledgePoint",
    "Document",
    "DocumentChunk",
    "DocumentPage",
    "PageKnowledgePoint",
    "SystemConfig",
    "EmailVerification",
    "AuditLog",
    "Conversation",
    "Message",
    "StudentProfile",
    "LearningSession",
    "LearningStage",
    "GeneratedResource",
    "AgentTask",
]
