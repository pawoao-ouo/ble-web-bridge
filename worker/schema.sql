-- 命令队列。控制端只 INSERT，页面只 SELECT 最新一条。
CREATE TABLE IF NOT EXISTS commands (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  seq  INTEGER NOT NULL UNIQUE,   -- 单调递增，页面用它判断"这条我执行过没"
  cmd  TEXT    NOT NULL,          -- level / stop / pattern
  args TEXT    NOT NULL DEFAULT '{}',  -- JSON 字符串
  ts   INTEGER NOT NULL           -- 毫秒时间戳
);

CREATE INDEX IF NOT EXISTS idx_commands_seq ON commands(seq DESC);

-- 可选：只保留最近 500 条，避免无限增长。
-- 在 push 之后偶尔跑一次即可，不必每次。
-- DELETE FROM commands WHERE seq < (SELECT MIN(seq) FROM (SELECT seq FROM commands ORDER BY seq DESC LIMIT 500));
