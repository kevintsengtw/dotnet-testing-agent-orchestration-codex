using Microsoft.EntityFrameworkCore;
using Practice.Aspire.Net8.WebApi.Models;

namespace Practice.Aspire.Net8.WebApi.Data;

/// <summary>
/// 預約資料庫上下文
/// </summary>
public class BookingDbContext : DbContext
{
    public BookingDbContext(DbContextOptions<BookingDbContext> options)
        : base(options)
    {
    }

    /// <summary>
    /// 預約資料表
    /// </summary>
    public DbSet<Booking> Bookings => Set<Booking>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Booking>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.GuestName).IsRequired().HasMaxLength(200);
            entity.Property(e => e.GuestEmail).IsRequired().HasMaxLength(320);
            entity.Property(e => e.RoomNumber).IsRequired().HasMaxLength(20);
            entity.Property(e => e.TotalPrice).HasPrecision(18, 2);
            entity.Property(e => e.Notes).HasMaxLength(1000);
            entity.Property(e => e.Status).HasConversion<int>();
        });
    }
}
