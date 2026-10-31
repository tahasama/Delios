using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <inheritdoc />
    public partial class TrainingSpace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "space",
                table: "projects",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "training_project_id",
                table: "parties",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_parties_training_project_id",
                table: "parties",
                column: "training_project_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_parties_training_project_id",
                table: "parties");

            migrationBuilder.DropColumn(
                name: "space",
                table: "projects");

            migrationBuilder.DropColumn(
                name: "training_project_id",
                table: "parties");
        }
    }
}
