using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Practice.Integration.WebApi.Net10.Interfaces;
using Practice.Integration.WebApi.Net10.Models;

namespace Practice.Integration.WebApi.Net10.Controllers;

/// <summary>
/// 客戶活動 API 控制器
/// 透過 MongoDB 儲存與查詢客戶活動記錄
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class CustomerActivitiesController : ControllerBase
{
    private readonly ICustomerActivityRepository _repository;
    private readonly TimeProvider _timeProvider;
    private readonly IValidator<CreateCustomerActivityRequest> _createValidator;

    public CustomerActivitiesController(
        ICustomerActivityRepository repository,
        TimeProvider timeProvider,
        IValidator<CreateCustomerActivityRequest> createValidator)
    {
        _repository = repository;
        _timeProvider = timeProvider;
        _createValidator = createValidator;
    }

    /// <summary>
    /// 建立客戶活動記錄
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<CustomerActivity>> Create(CreateCustomerActivityRequest request)
    {
        await _createValidator.ValidateAndThrowAsync(request);

        var activity = new CustomerActivity
        {
            CustomerId = request.CustomerId,
            ActivityType = request.ActivityType,
            Description = request.Description,
            Timestamp = _timeProvider.GetUtcNow().UtcDateTime,
            Metadata = request.Metadata
        };

        var created = await _repository.CreateAsync(activity);

        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
    }

    /// <summary>
    /// 根據 ID 取得客戶活動
    /// </summary>
    [HttpGet("{id}")]
    public async Task<ActionResult<CustomerActivity>> GetById(string id)
    {
        var activity = await _repository.GetByIdAsync(id);

        if (activity is null)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的客戶活動記錄",
                Instance = HttpContext.Request.Path
            });
        }

        return Ok(activity);
    }

    /// <summary>
    /// 根據客戶 ID 取得所有活動記錄
    /// </summary>
    [HttpGet("by-customer/{customerId}")]
    public async Task<ActionResult<IEnumerable<CustomerActivity>>> GetByCustomerId(string customerId)
    {
        var activities = await _repository.GetByCustomerIdAsync(customerId);
        return Ok(activities);
    }

    /// <summary>
    /// 根據活動類型取得活動記錄
    /// </summary>
    [HttpGet("by-type/{activityType}")]
    public async Task<ActionResult<IEnumerable<CustomerActivity>>> GetByActivityType(string activityType)
    {
        var activities = await _repository.GetByActivityTypeAsync(activityType);
        return Ok(activities);
    }

    /// <summary>
    /// 刪除客戶活動記錄
    /// </summary>
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        var deleted = await _repository.DeleteAsync(id);

        if (!deleted)
        {
            return NotFound(new ProblemDetails
            {
                Status = StatusCodes.Status404NotFound,
                Title = "找不到資源",
                Detail = $"找不到 ID 為 {id} 的客戶活動記錄",
                Instance = HttpContext.Request.Path
            });
        }

        return NoContent();
    }
}
