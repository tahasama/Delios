# Postgres with pgBackRest: continuous WAL archiving, scheduled backups, restore
# drills, and a standby mode. Debian-based (glibc): the collation the data is
# sorted with must not change under an existing database, so this base stays.
FROM postgres:17
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbackrest \
 && rm -rf /var/lib/apt/lists/*
COPY --chmod=755 entrypoint.sh /usr/local/bin/delios-entrypoint.sh
COPY --chmod=755 pgbackrest-conf.sh backup-loop.sh restore-drill.sh /usr/local/bin/
COPY --chmod=755 initdb/ /docker-entrypoint-initdb.d/
# A Windows checkout can turn line endings into CRLF, and a script with CRLF
# fails to start ("No such file or directory"). Strip them whatever the checkout.
RUN sed -i 's/\r$//' /usr/local/bin/delios-entrypoint.sh /usr/local/bin/pgbackrest-conf.sh \
      /usr/local/bin/backup-loop.sh /usr/local/bin/restore-drill.sh /docker-entrypoint-initdb.d/*
# No USER on purpose: as in the official image, the entrypoint starts as root only to set up its folders, then
# runs Postgres and the backups as the postgres user (gosu). A USER here would stop it from starting.
# nosemgrep: dockerfile.security.missing-user-entrypoint.missing-user-entrypoint
ENTRYPOINT ["delios-entrypoint.sh"]
# nosemgrep: dockerfile.security.missing-user.missing-user
CMD ["postgres"]
