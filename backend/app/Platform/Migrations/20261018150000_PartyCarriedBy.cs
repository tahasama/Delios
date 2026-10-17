using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Delios.Host.Platform.Migrations
{
    /// <summary>The person of ours who carries the exchange with an organization not on DELIOS (empty: the control function).</summary>
    public partial class PartyCarriedBy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(name: "carried_by_user_id", table: "parties", type: "uuid", nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "carried_by_user_id", table: "parties");
        }
    }
}
