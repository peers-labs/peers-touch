# Broker B (DB)

- 内核：关系型数据库（PostgreSQL）作为持久化事件存储与游标拉取；可演进为 `LISTEN/NOTIFY`。
- 官网：https://www.postgresql.org/
- 适用：中等规模、易部署、与事务 Outbox 集成友好。

