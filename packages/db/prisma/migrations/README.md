# Application migrations

`20260915000000_baseline` describes the application schema that existed before
Prisma migration files were checked in. New empty databases apply it normally.
On an existing installation, verify the application tables match that schema,
back up PostgreSQL, then mark the baseline applied with:

```
prisma migrate resolve --applied 20260915000000_baseline --schema packages/db/prisma/schema.prisma
prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

Never run the baseline SQL directly against an existing database. Do not use
`migrate reset` or `db push` in production. The production database also contains
LiteLLM tables and its migration history; preserve both.

The assets/requests migration only adds tables, enums, indexes, and an optional
employee link on users. Existing accounts remain unlinked. An IT administrator
can verify identities and link accounts on the Change Requests page.

API integration tests require a disposable database whose URL contains
`jmlops_test`. Apply these migrations, build the workspace packages, then run:

```
node --test apps/api/test/requests.integration.cjs
```

The tests use real PostgreSQL relationships and transactions; AI parsing and
queue submission are stubbed so no external accounts are changed.
