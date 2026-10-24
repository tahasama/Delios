using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class PackageBranches : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "parent_id",
                table: "packages",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_packages_parent_id",
                table: "packages",
                column: "parent_id");

            migrationBuilder.AddForeignKey(
                name: "fk_packages_packages_parent_id",
                table: "packages",
                column: "parent_id",
                principalTable: "packages",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_packages_packages_parent_id",
                table: "packages");

            migrationBuilder.DropIndex(
                name: "ix_packages_parent_id",
                table: "packages");

            migrationBuilder.DropColumn(
                name: "parent_id",
                table: "packages");
        }
    }
}
