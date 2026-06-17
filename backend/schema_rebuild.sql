-- ==========================================
-- MLA 多学助手 — 完整建表 DDL (PostgreSQL)
-- 来源: DataBase.md
-- 使用 gen_random_uuid() 代替 uuid_generate_v4() (PG 13+ 内置)
-- ==========================================

-- 1. users — 用户表
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(50)  NOT NULL UNIQUE,
    email           VARCHAR(100) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(50),
    school          VARCHAR(100),
    major           VARCHAR(100),
    grade           VARCHAR(20),
    education_level VARCHAR(20),
    role            VARCHAR(20)  NOT NULL DEFAULT 'student',
    avatar          VARCHAR(500),
    nickname        VARCHAR(50),
    email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_username ON users (username);
CREATE INDEX idx_users_email    ON users (email);

-- 2. courses — 课程表
CREATE TABLE courses (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    cover_image VARCHAR(500),
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_courses_name ON courses (name);

-- 3. chapters — 章节表
CREATE TABLE chapters (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id   UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    order_index INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 4. knowledge_points — 知识点表
CREATE TABLE knowledge_points (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id         UUID         NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    title              VARCHAR(200) NOT NULL,
    description        TEXT,
    content            TEXT,
    prerequisite_kp_id UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
    kp_type            VARCHAR(20)  NOT NULL DEFAULT 'item',
    parent_kp_id       UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
    difficulty         VARCHAR(20)  NOT NULL DEFAULT 'medium',
    source_type        VARCHAR(20)  NOT NULL DEFAULT 'manual',
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 5. documents — 文档表
CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id     UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    chapter_id    UUID REFERENCES chapters(id) ON DELETE SET NULL,
    filename      VARCHAR(255) NOT NULL,
    file_type     VARCHAR(20)  NOT NULL,
    file_size     INTEGER      NOT NULL DEFAULT 0,
    file_path     VARCHAR(500) NOT NULL,
    parse_status  VARCHAR(20)  NOT NULL DEFAULT 'pending',
    chunk_count   INTEGER      NOT NULL DEFAULT 0,
    page_count    INTEGER      NOT NULL DEFAULT 0,
    kp_count      INTEGER      NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 6. document_chunks — 文本切片表 (DOCX/MD/TXT)
CREATE TABLE document_chunks (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id        UUID    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    knowledge_point_id UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
    chunk_index        INTEGER NOT NULL DEFAULT 0,
    content            TEXT    NOT NULL,
    chunk_metadata     JSONB   DEFAULT '{}'::jsonb,
    token_count        INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. document_pages — 文档页面表 (PDF/PPTX)
CREATE TABLE document_pages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_number   INTEGER      NOT NULL,
    image_path    VARCHAR(500) NOT NULL,
    summary       TEXT,
    extracted_kps JSONB        DEFAULT '[]'::jsonb,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 8. page_knowledge_points — 页面-知识点关联表
CREATE TABLE page_knowledge_points (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_page_id   UUID    NOT NULL REFERENCES document_pages(id) ON DELETE CASCADE,
    knowledge_point_id UUID    NOT NULL REFERENCES knowledge_points(id) ON DELETE CASCADE,
    relevance          FLOAT   NOT NULL DEFAULT 1.0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_page_kp UNIQUE (document_page_id, knowledge_point_id)
);

-- 9. conversations — 对话表
CREATE TABLE conversations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id               UUID REFERENCES courses(id) ON DELETE SET NULL,
    title                   VARCHAR(200) NOT NULL DEFAULT '新对话',
    conversation_type       VARCHAR(20)  NOT NULL DEFAULT 'chat',
    profile_collection_stage VARCHAR(50),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. messages — 消息表
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL,
    content         TEXT        NOT NULL,
    sources         JSONB,
    message_metadata JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. student_profiles — 学生画像表
CREATE TABLE student_profiles (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    profile_data      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    confidence_scores JSONB       NOT NULL DEFAULT '{}'::jsonb,
    missing_fields    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    summary           TEXT,
    memories          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    version           INTEGER     NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_student_profiles_user_id ON student_profiles (user_id);

-- 12. system_configs — 系统配置表
CREATE TABLE system_configs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    config_key   VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT         NOT NULL DEFAULT '',
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_system_configs_key ON system_configs (config_key);

-- 13. email_verifications — 邮箱验证码表
CREATE TABLE email_verifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      VARCHAR(100) NOT NULL,
    code       VARCHAR(6)   NOT NULL,
    purpose    VARCHAR(20)  NOT NULL,
    expires_at TIMESTAMPTZ  NOT NULL,
    used       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_email_verifications_email ON email_verifications (email);

-- 14. audit_logs — 审计日志表
CREATE TABLE audit_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID,
    action     VARCHAR(50)  NOT NULL,
    ip_address VARCHAR(50),
    user_agent VARCHAR(500),
    details    JSONB        DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_action  ON audit_logs (action);
