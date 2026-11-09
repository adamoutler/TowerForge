using Microsoft.AspNetCore.Mvc;
using TowerForge.Server.LiveStreams;

namespace TowerForge.Server.Controllers;

// ============================================================
//  Creator Codes: which creators are streaming The Tower now.
//  GET /api/creators/live → { checkedAt, live: [{ code, platform,
//  url, title, startedAt, viewers }] }, from the server's own check
//  (LiveStreamService); the visitor sends nothing. Browsers may keep
//  it a minute — the check runs every 2–4 minutes anyway.
// ============================================================
[ApiController]
[Route("api/creators")]
public class CreatorsController : ControllerBase
{
    private readonly LiveStreamService _live;

    public CreatorsController(LiveStreamService live) => _live = live;

    [HttpGet("live")]
    public LiveSnapshot Live()
    {
        Response.Headers.CacheControl = "public, max-age=60";
        return _live.Snapshot;
    }
}
