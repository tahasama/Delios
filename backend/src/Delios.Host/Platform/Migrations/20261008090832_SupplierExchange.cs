using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class SupplierExchange : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "from_name",
                table: "transmittals",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "from_party_id",
                table: "transmittals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "proof_file_id",
                table: "transmittals",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "their_reference",
                table: "transmittals",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "revision_id",
                table: "transmittal_items",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AlterColumn<Guid>(
                name: "document_id",
                table: "transmittal_items",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<string>(
                name: "doc_type",
                table: "transmittal_items",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<LocalDate>(
                name: "due_date",
                table: "transmittal_items",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "transmittal_items",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "REVISION");

            migrationBuilder.AddColumn<Instant>(
                name: "registered_at",
                table: "transmittal_items",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "registered_by_name",
                table: "transmittal_items",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "submission",
                table: "transmittal_items",
                type: "integer",
                nullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "document_id",
                table: "stored_files",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<Guid>(
                name: "transmittal_item_id",
                table: "stored_files",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "kind",
                table: "packages",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "DELIVERY");

            migrationBuilder.AddColumn<string>(
                name: "purchase_order",
                table: "packages",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "supplier_party_id",
                table: "packages",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "requested_at",
                table: "package_members",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_from_party_id",
                table: "transmittals",
                column: "from_party_id");

            migrationBuilder.CreateIndex(
                name: "ix_transmittals_proof_file_id",
                table: "transmittals",
                column: "proof_file_id");

            migrationBuilder.CreateIndex(
                name: "ix_stored_files_transmittal_item_id",
                table: "stored_files",
                column: "transmittal_item_id");

            migrationBuilder.CreateIndex(
                name: "ix_packages_supplier_party_id",
                table: "packages",
                column: "supplier_party_id");

            migrationBuilder.AddForeignKey(
                name: "fk_packages_parties_supplier_party_id",
                table: "packages",
                column: "supplier_party_id",
                principalTable: "parties",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_stored_files_transmittal_items_transmittal_item_id",
                table: "stored_files",
                column: "transmittal_item_id",
                principalTable: "transmittal_items",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_transmittals_parties_from_party_id",
                table: "transmittals",
                column: "from_party_id",
                principalTable: "parties",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "fk_transmittals_stored_files_proof_file_id",
                table: "transmittals",
                column: "proof_file_id",
                principalTable: "stored_files",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            // A package is kept like every other record, except one that is empty and never went out: that one may
            // be deleted (its number is not given out again).
            migrationBuilder.Sql("""
                CREATE FUNCTION packages_kept_unless_empty() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    IF OLD.state = 'OPEN'
                        AND NOT EXISTS (SELECT 1 FROM package_members m WHERE m.package_id = OLD.id)
                        AND NOT EXISTS (SELECT 1 FROM transmittals t WHERE t.package_id = OLD.id) THEN
                        RETURN OLD;
                    END IF;
                    RAISE EXCEPTION 'packages records are kept: only an empty package that never went out is deleted'
                        USING ERRCODE = 'restrict_violation';
                END
                $$;
                DROP TRIGGER packages_kept ON packages;
                CREATE TRIGGER packages_kept BEFORE DELETE ON packages FOR EACH ROW EXECUTE FUNCTION packages_kept_unless_empty();
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                DROP TRIGGER packages_kept ON packages;
                CREATE TRIGGER packages_kept BEFORE DELETE ON packages FOR EACH ROW EXECUTE FUNCTION records_are_kept();
                DROP FUNCTION packages_kept_unless_empty();
                """);

            migrationBuilder.DropForeignKey(
                name: "fk_packages_parties_supplier_party_id",
                table: "packages");

            migrationBuilder.DropForeignKey(
                name: "fk_stored_files_transmittal_items_transmittal_item_id",
                table: "stored_files");

            migrationBuilder.DropForeignKey(
                name: "fk_transmittals_parties_from_party_id",
                table: "transmittals");

            migrationBuilder.DropForeignKey(
                name: "fk_transmittals_stored_files_proof_file_id",
                table: "transmittals");

            migrationBuilder.DropIndex(
                name: "ix_transmittals_from_party_id",
                table: "transmittals");

            migrationBuilder.DropIndex(
                name: "ix_transmittals_proof_file_id",
                table: "transmittals");

            migrationBuilder.DropIndex(
                name: "ix_stored_files_transmittal_item_id",
                table: "stored_files");

            migrationBuilder.DropIndex(
                name: "ix_packages_supplier_party_id",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "from_name",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "from_party_id",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "proof_file_id",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "their_reference",
                table: "transmittals");

            migrationBuilder.DropColumn(
                name: "doc_type",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "due_date",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "kind",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "registered_at",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "registered_by_name",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "submission",
                table: "transmittal_items");

            migrationBuilder.DropColumn(
                name: "transmittal_item_id",
                table: "stored_files");

            migrationBuilder.DropColumn(
                name: "kind",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "purchase_order",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "supplier_party_id",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "requested_at",
                table: "package_members");

            migrationBuilder.AlterColumn<Guid>(
                name: "revision_id",
                table: "transmittal_items",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "document_id",
                table: "transmittal_items",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.AlterColumn<Guid>(
                name: "document_id",
                table: "stored_files",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);
        }
    }
}
