import { jest } from "@jest/globals";

import { invalidateProjectResponseCache } from "../apps/gateway/src/utils/cache.js";

describe("Project Response Cache Invalidation", () => {
  test("should delete matching project response cache entries", async () => {
    const client = {
      isOpen: true,
      scan: jest
        .fn()
        .mockResolvedValueOnce({
          cursor: "1",
          keys: ["gateway:response:project1:a"],
        })
        .mockResolvedValueOnce({
          cursor: "0",
          keys: ["gateway:response:project1:b"],
        }),
      del: jest.fn().mockResolvedValue(1),
    };

    const deleted = await invalidateProjectResponseCache("project1", {
      client,
    });

    expect(deleted).toBe(2);
    expect(client.scan).toHaveBeenCalledTimes(2);
    expect(client.del).toHaveBeenCalledTimes(2);
    expect(client.scan).toHaveBeenCalledWith("0", {
      MATCH: "gateway:response:project1:*",
      COUNT: 100,
    });
  });

  test("should return zero when Redis is unavailable", async () => {
    const client = {
      isOpen: false,
    };

    const deleted = await invalidateProjectResponseCache("project1", {
      client,
    });

    expect(deleted).toBe(0);
  });

  test("should handle Redis scan failure safely", async () => {
    const client = {
      isOpen: true,
      scan: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
    };

    const deleted = await invalidateProjectResponseCache("project1", {
      client,
    });

    expect(deleted).toBe(0);
  });
});
