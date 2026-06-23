using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Practice.Aspire.Net10.WebApi.Data;
using Practice.Aspire.Net10.WebApi.Handlers;
using Practice.Aspire.Net10.WebApi.Validators;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Add DbContext with SQL Server（連線字串由 Aspire AppHost 注入）
var connectionString = builder.Configuration.GetConnectionString("BookingsDb")
    ?? throw new InvalidOperationException("Connection string 'BookingsDb' not found.");
builder.Services.AddDbContext<BookingDbContext>(options =>
    options.UseSqlServer(connectionString));

// Add Redis（連線字串由 Aspire AppHost 注入）
var redisConnectionString = builder.Configuration.GetConnectionString("cache")
    ?? "localhost:6379";
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(redisConnectionString));

// Add TimeProvider
builder.Services.AddSingleton(TimeProvider.System);

// Add FluentValidation
builder.Services.AddValidatorsFromAssemblyContaining<CreateBookingRequestValidator>();

// Add Exception Handlers (order matters: specific before global)
builder.Services.AddExceptionHandler<FluentValidationExceptionHandler>();
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseExceptionHandler();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();

// Make Program class accessible for testing
public partial class Program { }
