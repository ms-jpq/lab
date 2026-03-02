# PostgreSQL

## ZFS

```bash
zfs set recordsize=32K '<dataset>'
```

## Dump

```bash
# No `.s.PGSQL.5432` required
pg_dump --dbname 'postgres' --username 'postgres' --no-owner --host '/run/local/postgresql/<instance>'
psql --dbname 'postgres' --username 'postgres' --single-transaction --host '/run/local/postgresql/<instance>'
```
