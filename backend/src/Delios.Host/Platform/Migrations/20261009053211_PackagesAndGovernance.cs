using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NodaTime;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class PackagesAndGovernance : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Instant>(
                name: "approval_withdrawn_at",
                table: "reviews",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "approval_withdrawn_by_name",
                table: "reviews",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "approval_withdrawn_reason",
                table: "reviews",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "original_blocking",
                table: "review_comments",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<Instant>(
                name: "reclassified_at",
                table: "review_comments",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "reclassified_by_name",
                table: "review_comments",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "extras",
                table: "packages",
                type: "jsonb",
                nullable: true);

            migrationBuilder.AddColumn<string[]>(
                name: "other_reasons",
                table: "packages",
                type: "text[]",
                nullable: false,
                defaultValue: new string[0]);

            migrationBuilder.AddColumn<Instant>(
                name: "confirmed_at",
                table: "documents",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "confirmed_by_name",
                table: "documents",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "corrects_id",
                table: "documents",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_documents_corrects_id",
                table: "documents",
                column: "corrects_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_documents_corrects_id",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "approval_withdrawn_at",
                table: "reviews");

            migrationBuilder.DropColumn(
                name: "approval_withdrawn_by_name",
                table: "reviews");

            migrationBuilder.DropColumn(
                name: "approval_withdrawn_reason",
                table: "reviews");

            migrationBuilder.DropColumn(
                name: "original_blocking",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "reclassified_at",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "reclassified_by_name",
                table: "review_comments");

            migrationBuilder.DropColumn(
                name: "extras",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "other_reasons",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "confirmed_at",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "confirmed_by_name",
                table: "documents");

            migrationBuilder.DropColumn(
                name: "corrects_id",
                table: "documents");
        }
    }
}
