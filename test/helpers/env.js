// Test environment: no real Discord token, no database (in-memory storage).
process.env.NODE_ENV = 'test';
process.env.DISCORD_TOKEN ||= 'test-token';
process.env.CLIENT_ID ||= '100000000000000000';
process.env.LOG_LEVEL ||= 'error';
process.env.LOG_TO_FILE = 'false';
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_HOST;
