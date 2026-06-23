using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Practice.Aspire.Net10.WebApi.Data;
using Practice.Aspire.Net10.WebApi.Models;

namespace Practice.Aspire.Net10.WebApi.Controllers;

/// <summary>
/// 預約 API 控制器
/// 展示完整的 CRUD 操作與狀態轉換
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class BookingsController : ControllerBase
{
    private readonly BookingDbContext _context;
    private readonly IValidator<CreateBookingRequest> _createValidator;
    private readonly IValidator<UpdateBookingRequest> _updateValidator;
    private readonly TimeProvider _timeProvider;

    public BookingsController(
        BookingDbContext context,
        IValidator<CreateBookingRequest> createValidator,
        IValidator<UpdateBookingRequest> updateValidator,
        TimeProvider timeProvider)
    {
        _context = context;
        _createValidator = createValidator;
        _updateValidator = updateValidator;
        _timeProvider = timeProvider;
    }

    /// <summary>
    /// 取得所有預約
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<Booking>>> GetAll()
    {
        var bookings = await _context.Bookings.ToListAsync();
        return Ok(bookings);
    }

    /// <summary>
    /// 根據 ID 取得單一預約
    /// </summary>
    [HttpGet("{id}")]
    public async Task<ActionResult<Booking>> GetById(int id)
    {
        var booking = await _context.Bookings.FindAsync(id);

        if (booking is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的預約",
                Instance = HttpContext.Request.Path
            });
        }

        return Ok(booking);
    }

    /// <summary>
    /// 根據狀態查詢預約
    /// </summary>
    [HttpGet("by-status/{status}")]
    public async Task<ActionResult<IEnumerable<Booking>>> GetByStatus(BookingStatus status)
    {
        var bookings = await _context.Bookings
            .Where(b => b.Status == status)
            .OrderByDescending(b => b.CheckInDate)
            .ToListAsync();

        return Ok(bookings);
    }

    /// <summary>
    /// 建立新預約
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<Booking>> Create(CreateBookingRequest request)
    {
        var validationResult = await _createValidator.ValidateAsync(request);
        if (!validationResult.IsValid)
        {
            throw new ValidationException(validationResult.Errors);
        }

        var booking = new Booking
        {
            GuestName = request.GuestName,
            GuestEmail = request.GuestEmail,
            RoomNumber = request.RoomNumber,
            CheckInDate = request.CheckInDate,
            CheckOutDate = request.CheckOutDate,
            TotalPrice = request.TotalPrice,
            Notes = request.Notes,
            Status = BookingStatus.Pending,
            CreatedAt = _timeProvider.GetUtcNow().UtcDateTime
        };

        _context.Bookings.Add(booking);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = booking.Id }, booking);
    }

    /// <summary>
    /// 更新預約
    /// </summary>
    [HttpPut("{id}")]
    public async Task<ActionResult<Booking>> Update(int id, UpdateBookingRequest request)
    {
        var validationResult = await _updateValidator.ValidateAsync(request);
        if (!validationResult.IsValid)
        {
            throw new ValidationException(validationResult.Errors);
        }

        var booking = await _context.Bookings.FindAsync(id);

        if (booking is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的預約",
                Instance = HttpContext.Request.Path
            });
        }

        booking.GuestName = request.GuestName;
        booking.GuestEmail = request.GuestEmail;
        booking.RoomNumber = request.RoomNumber;
        booking.CheckInDate = request.CheckInDate;
        booking.CheckOutDate = request.CheckOutDate;
        booking.TotalPrice = request.TotalPrice;
        booking.Notes = request.Notes;
        booking.UpdatedAt = _timeProvider.GetUtcNow().UtcDateTime;

        await _context.SaveChangesAsync();

        return Ok(booking);
    }

    /// <summary>
    /// 確認預約
    /// </summary>
    [HttpPatch("{id}/confirm")]
    public async Task<ActionResult<Booking>> Confirm(int id)
    {
        var booking = await _context.Bookings.FindAsync(id);

        if (booking is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的預約",
                Instance = HttpContext.Request.Path
            });
        }

        if (booking.Status != BookingStatus.Pending)
        {
            return Conflict(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "狀態衝突",
                Detail = $"預約目前狀態為 {booking.Status}，只有 Pending 狀態的預約可以確認",
                Instance = HttpContext.Request.Path
            });
        }

        booking.Status = BookingStatus.Confirmed;
        booking.UpdatedAt = _timeProvider.GetUtcNow().UtcDateTime;

        await _context.SaveChangesAsync();

        return Ok(booking);
    }

    /// <summary>
    /// 辦理入住
    /// </summary>
    [HttpPatch("{id}/checkin")]
    public async Task<ActionResult<Booking>> CheckIn(int id)
    {
        var booking = await _context.Bookings.FindAsync(id);

        if (booking is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的預約",
                Instance = HttpContext.Request.Path
            });
        }

        if (booking.Status != BookingStatus.Confirmed)
        {
            return Conflict(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "狀態衝突",
                Detail = $"預約目前狀態為 {booking.Status}，只有 Confirmed 狀態的預約可以辦理入住",
                Instance = HttpContext.Request.Path
            });
        }

        booking.Status = BookingStatus.CheckedIn;
        booking.UpdatedAt = _timeProvider.GetUtcNow().UtcDateTime;

        await _context.SaveChangesAsync();

        return Ok(booking);
    }

    /// <summary>
    /// 取消預約
    /// </summary>
    [HttpPatch("{id}/cancel")]
    public async Task<ActionResult<Booking>> Cancel(int id)
    {
        var booking = await _context.Bookings.FindAsync(id);

        if (booking is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的預約",
                Instance = HttpContext.Request.Path
            });
        }

        if (booking.Status == BookingStatus.CheckedOut || booking.Status == BookingStatus.Cancelled)
        {
            return Conflict(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "狀態衝突",
                Detail = $"預約目前狀態為 {booking.Status}，已退房或已取消的預約無法再取消",
                Instance = HttpContext.Request.Path
            });
        }

        booking.Status = BookingStatus.Cancelled;
        booking.UpdatedAt = _timeProvider.GetUtcNow().UtcDateTime;

        await _context.SaveChangesAsync();

        return Ok(booking);
    }

    /// <summary>
    /// 刪除預約
    /// </summary>
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var booking = await _context.Bookings.FindAsync(id);

        if (booking is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的預約",
                Instance = HttpContext.Request.Path
            });
        }

        _context.Bookings.Remove(booking);
        await _context.SaveChangesAsync();

        return NoContent();
    }
}
