using FluentValidation;
using Microsoft.EntityFrameworkCore;
using MongoDB.Driver;
using Practice.Integration.WebApi.Net8.Configuration;
using Practice.Integration.WebApi.Net8.Data;
using Practice.Integration.WebApi.Net8.Handlers;
using Practice.Integration.WebApi.Net8.Interfaces;
using Practice.Integration.WebApi.Net8.Services;
using Practice.Integration.WebApi.Net8.Validators;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// Add DbContext with PostgreSQL
if (!builder.Environment.IsEnvironment("Testing"))
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection")
        ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");
    builder.Services.AddDbContext<OrderDbContext>(options =>
        options.UseNpgsql(connectionString));
}

// Add MongoDB
builder.Services.Configure<MongoDbSettings>(
    builder.Configuration.GetSection("MongoDb"));

if (!builder.Environment.IsEnvironment("Testing"))
{
    var mongoDbSettings = builder.Configuration.GetSection("MongoDb").Get<MongoDbSettings>()
        ?? new MongoDbSettings();
    builder.Services.AddSingleton<IMongoClient>(_ => new MongoClient(mongoDbSettings.ConnectionString));
    builder.Services.AddSingleton<IMongoDatabase>(sp =>
        sp.GetRequiredService<IMongoClient>().GetDatabase(mongoDbSettings.DatabaseName));

    // Add Redis
    var redisConnectionString = builder.Configuration.GetConnectionString("Redis")
        ?? "localhost:6379";
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
        ConnectionMultiplexer.Connect(redisConnectionString));
    builder.Services.AddSingleton<ICacheService, RedisCacheService>();
}

// Add TimeProvider
builder.Services.AddSingleton(TimeProvider.System);

// Add Repositories and Services
builder.Services.AddScoped<ICustomerActivityRepository, MongoCustomerActivityRepository>();

// Add FluentValidation
builder.Services.AddValidatorsFromAssemblyContaining<CreateOrderRequestValidator>();

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

// Make Program class accessible for WebApplicationFactory
public partial class Program { }
