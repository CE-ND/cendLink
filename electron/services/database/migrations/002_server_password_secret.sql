-- remember_password：用户是否主动勾选“记住密码”。
ALTER TABLE servers ADD COLUMN remember_password INTEGER NOT NULL DEFAULT 0;
-- password_secret：Electron safeStorage 加密后的密码密文，不保存明文密码。
ALTER TABLE servers ADD COLUMN password_secret TEXT NOT NULL DEFAULT '';
