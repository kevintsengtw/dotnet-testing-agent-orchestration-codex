using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Practice.Integration.WebApi.Net10.Data;
using Practice.Integration.WebApi.Net10.Models;

namespace Practice.Integration.WebApi.Net10.Controllers;

/// <summary>
/// 訂單 API 控制器
/// 展示完整的 CRUD 操作與整合測試場景
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly OrderDbContext _context;
    private readonly IValidator<CreateOrderRequest> _createValidator;
    private readonly IValidator<UpdateOrderRequest> _updateValidator;
    private readonly TimeProvider _timeProvider;

    public OrdersController(
        OrderDbContext context,
        IValidator<CreateOrderRequest> createValidator,
        IValidator<UpdateOrderRequest> updateValidator,
        TimeProvider timeProvider)
    {
        _context = context;
        _createValidator = createValidator;
        _updateValidator = updateValidator;
        _timeProvider = timeProvider;
    }

    /// <summary>
    /// 取得所有訂單
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<Order>>> GetAll()
    {
        var orders = await _context.Orders.ToListAsync();
        return Ok(orders);
    }

    /// <summary>
    /// 根據 ID 取得單一訂單
    /// </summary>
    [HttpGet("{id}")]
    public async Task<ActionResult<Order>> GetById(int id)
    {
        var order = await _context.Orders.FindAsync(id);

        if (order is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的訂單",
                Instance = HttpContext.Request.Path
            });
        }

        return Ok(order);
    }

    /// <summary>
    /// 根據狀態查詢訂單
    /// </summary>
    [HttpGet("by-status/{status}")]
    public async Task<ActionResult<IEnumerable<Order>>> GetByStatus(OrderStatus status)
    {
        var orders = await _context.Orders
            .Where(o => o.Status == status)
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync();

        return Ok(orders);
    }

    /// <summary>
    /// 建立新訂單
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<Order>> Create(CreateOrderRequest request)
    {
        var validationResult = await _createValidator.ValidateAsync(request);
        if (!validationResult.IsValid)
        {
            throw new ValidationException(validationResult.Errors);
        }

        var order = new Order
        {
            CustomerName = request.CustomerName,
            CustomerEmail = request.CustomerEmail,
            TotalAmount = request.TotalAmount,
            Notes = request.Notes,
            Status = OrderStatus.Pending,
            CreatedAt = _timeProvider.GetUtcNow().UtcDateTime
        };

        _context.Orders.Add(order);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = order.Id }, order);
    }

    /// <summary>
    /// 更新訂單
    /// </summary>
    [HttpPut("{id}")]
    public async Task<ActionResult<Order>> Update(int id, UpdateOrderRequest request)
    {
        var validationResult = await _updateValidator.ValidateAsync(request);
        if (!validationResult.IsValid)
        {
            throw new ValidationException(validationResult.Errors);
        }

        var order = await _context.Orders.FindAsync(id);

        if (order is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的訂單",
                Instance = HttpContext.Request.Path
            });
        }

        order.CustomerName = request.CustomerName;
        order.CustomerEmail = request.CustomerEmail;
        order.TotalAmount = request.TotalAmount;
        order.Notes = request.Notes;
        order.UpdatedAt = _timeProvider.GetUtcNow().UtcDateTime;

        await _context.SaveChangesAsync();

        return Ok(order);
    }

    /// <summary>
    /// 確認訂單
    /// </summary>
    [HttpPatch("{id}/confirm")]
    public async Task<ActionResult<Order>> Confirm(int id)
    {
        var order = await _context.Orders.FindAsync(id);

        if (order is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的訂單",
                Instance = HttpContext.Request.Path
            });
        }

        if (order.Status != OrderStatus.Pending)
        {
            return Conflict(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "狀態衝突",
                Detail = $"訂單目前狀態為 {order.Status}，只有 Pending 狀態的訂單可以確認",
                Instance = HttpContext.Request.Path
            });
        }

        order.Status = OrderStatus.Confirmed;
        order.UpdatedAt = _timeProvider.GetUtcNow().UtcDateTime;

        await _context.SaveChangesAsync();

        return Ok(order);
    }

    /// <summary>
    /// 取消訂單
    /// </summary>
    [HttpPatch("{id}/cancel")]
    public async Task<ActionResult<Order>> Cancel(int id)
    {
        var order = await _context.Orders.FindAsync(id);

        if (order is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的訂單",
                Instance = HttpContext.Request.Path
            });
        }

        if (order.Status == OrderStatus.Delivered || order.Status == OrderStatus.Cancelled)
        {
            return Conflict(new ProblemDetails
            {
                Status = StatusCodes.Status409Conflict,
                Title = "狀態衝突",
                Detail = $"訂單目前狀態為 {order.Status}，已完成或已取消的訂單無法再取消",
                Instance = HttpContext.Request.Path
            });
        }

        order.Status = OrderStatus.Cancelled;
        order.UpdatedAt = _timeProvider.GetUtcNow().UtcDateTime;

        await _context.SaveChangesAsync();

        return Ok(order);
    }

    /// <summary>
    /// 刪除訂單
    /// </summary>
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var order = await _context.Orders.FindAsync(id);

        if (order is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的訂單",
                Instance = HttpContext.Request.Path
            });
        }

        _context.Orders.Remove(order);
        await _context.SaveChangesAsync();

        return NoContent();
    }
}
