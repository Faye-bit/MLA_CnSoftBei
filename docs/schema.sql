-- ============================================
-- MLA 智学引擎 — 数据库建表脚本 (PostgreSQL 17)
-- 生成日期: 2026-06-10
-- 包含 9 张表: 用户、课程、章节、知识点、文档、切片、配置、验证码、审计日志
-- ============================================

-- 1. 用户表 (users)
--    存储学生、教师、管理员的基础信息
CREATE TABLE users (
    id          UUID PRIMARY KEY,
    username    VARCHAR(50)  NOT NULL,
    email       VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name   VARCHAR(50),
    school      VARCHAR(100),
    major       VARCHAR(100),
    grade       VARCHAR(20),
    education_level VARCHAR(20),
    role        VARCHAR(20)  NOT NULL DEFAULT 'student',
    -- 以下 3 个字段为注册登录系统新增
    avatar      VARCHAR(500),                         -- 头像 URL
    nickname    VARCHAR(50),                          -- 显示昵称
    email_verified BOOLEAN   NOT NULL DEFAULT FALSE,  -- 邮箱是否已验证
    --
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ix_users_username ON users (username);
CREATE UNIQUE INDEX ix_users_email    ON users (email);


-- 2. 课程表 (courses)
--    一门完整的高校课程
CREATE TABLE courses (
    id          UUID PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    cover_image VARCHAR(500),
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_courses_name       ON courses (name);
CREATE INDEX ix_courses_created_by ON courses (created_by);


-- 3. 章节表 (chapters)
--    课程下的章节结构, 支持排序
CREATE TABLE chapters (
    id          UUID PRIMARY KEY,
    course_id   UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title       VARCHAR(200) NOT NULL,
    description TEXT,
    order_index INTEGER      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_chapters_course_id ON chapters (course_id);


-- 4. 知识点表 (knowledge_points)
--    每个章节下的具体知识点, 支持前置依赖关系(自引用)
CREATE TABLE knowledge_points (
    id                  UUID PRIMARY KEY,
    chapter_id          UUID        NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    title               VARCHAR(200) NOT NULL,
    description         TEXT,
    content             TEXT,
    prerequisite_kp_id  UUID        REFERENCES knowledge_points(id) ON DELETE SET NULL,
    difficulty          VARCHAR(20) NOT NULL DEFAULT 'medium',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_kp_chapter_id ON knowledge_points (chapter_id);


-- 5. 文档表 (documents)
--    用户上传的课程资料文件及其解析状态
CREATE TABLE documents (
    id           UUID PRIMARY KEY,
    course_id    UUID         NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    filename     VARCHAR(255) NOT NULL,
    file_type    VARCHAR(20)  NOT NULL,
    file_size    INTEGER      NOT NULL DEFAULT 0,
    file_path    VARCHAR(500) NOT NULL,
    parse_status VARCHAR(20)  NOT NULL DEFAULT 'pending',
    chunk_count  INTEGER      NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_documents_course_id ON documents (course_id);


-- 6. 文档切片表 (document_chunks)
--    文档解析后切分的文本片段, 用于向量检索
CREATE TABLE document_chunks (
    id                  UUID PRIMARY KEY,
    document_id         UUID    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    knowledge_point_id  UUID    REFERENCES knowledge_points(id) ON DELETE SET NULL,
    chunk_index         INTEGER NOT NULL DEFAULT 0,
    content             TEXT    NOT NULL,
    chunk_metadata      JSONB,
    token_count         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_chunks_document_id ON document_chunks (document_id);


-- 7. 系统配置表 (system_configs)
--    Key-Value 结构, 存储 LLM/Embedding API Key 等运行时配置
CREATE TABLE system_configs (
    id           UUID PRIMARY KEY,
    config_key   VARCHAR(100) NOT NULL,
    config_value TEXT         NOT NULL DEFAULT '',
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ix_system_configs_key ON system_configs (config_key);


-- 8. 邮箱验证码表 (email_verifications) — 注册登录系统新增
--    每条记录代表一次发送的验证码, 验证后标记为已使用
CREATE TABLE email_verifications (
    id          UUID PRIMARY KEY,
    email       VARCHAR(100) NOT NULL,
    code        VARCHAR(6)   NOT NULL,
    purpose     VARCHAR(20)  NOT NULL,    -- 'register' 或 'reset_password'
    expires_at  TIMESTAMPTZ  NOT NULL,    -- 过期时间 (默认 5 分钟)
    used        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_email_verifications_email ON email_verifications (email);


-- 9. 操作审计日志表 (audit_logs) — 注册登录系统新增
--    记录注册、登录、修改资料、密码重置等所有关键操作
CREATE TABLE audit_logs (
    id          UUID PRIMARY KEY,
    user_id     UUID,                     -- 可为空 (未登录时的注册操作)
    action      VARCHAR(50)  NOT NULL,    -- register / login / logout / update_profile 等
    ip_address  VARCHAR(50),
    user_agent  VARCHAR(500),
    details     JSONB,                    -- 额外信息 (被操作的用户ID、修改字段等)
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_audit_logs_user_id ON audit_logs (user_id);
CREATE INDEX ix_audit_logs_action  ON audit_logs (action);


-- ============================================
-- 推荐: 创建数据库用户和启用扩展 (首次部署时执行)
-- ============================================
-- CREATE USER mla WITH PASSWORD 'mla123';
-- CREATE DATABASE mla_db OWNER mla;
-- GRANT ALL PRIVILEGES ON DATABASE mla_db TO mla;
-- GRANT ALL ON SCHEMA public TO mla;
