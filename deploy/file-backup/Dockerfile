# The copier: rclone (pinned), and the Valkey client it waits on the list of files just stored with, taken from the
# Valkey image (pinned) so nothing is fetched from a package index.
FROM valkey/valkey:8-alpine@sha256:081c2f5cb575efc901aa80ff9cdbd1ec6a301682fd35e1ebb4b0990a4a4a8507 AS valkey
FROM rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5
COPY --from=valkey /usr/local/bin/valkey-cli /usr/local/bin/valkey-cli
COPY backup.sh /backup.sh
# Line endings stripped: a Windows checkout may have turned them into CRLF.
RUN tr -d '\r' < /backup.sh > /usr/local/bin/backup.sh && chmod +x /usr/local/bin/backup.sh && rm /backup.sh && valkey-cli --version
ENTRYPOINT ["/bin/sh", "/usr/local/bin/backup.sh"]
