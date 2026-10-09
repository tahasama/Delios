#!/bin/sh
# A standby may connect for replication.
echo "host replication replicator all scram-sha-256" >> "$PGDATA/pg_hba.conf"
