import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	applications: vi.fn(),
	eligible: vi.fn(),
	jobs: vi.fn(),
	add: vi.fn(),
}));
vi.mock("@dokploy/server/db", () => ({
	db: { query: { applications: { findMany: mocks.applications } } },
}));
vi.mock("@dokploy/server/utils/docker/missing-image", () => ({
	canRecoverMissingImage: mocks.eligible,
	MISSING_IMAGE_REBUILD_TITLE: "Recover missing image",
}));
vi.mock("../../server/queues/queueSetup", () => ({
	myQueue: { getJobs: mocks.jobs, add: mocks.add },
}));

import { recoverMissingImages } from "../../server/utils/missing-image-recovery";

beforeEach(() => {
	vi.resetAllMocks();
	mocks.applications.mockResolvedValue([
		{ applicationId: "app", serverId: null },
	]);
	mocks.jobs.mockResolvedValue([]);
	mocks.eligible.mockResolvedValue(true);
});
describe("missing-image recovery queue", () => {
	it("queues the existing redeploy operation", async () => {
		await recoverMissingImages();
		expect(mocks.add).toHaveBeenCalledWith(
			"deployments",
			expect.objectContaining({
				applicationId: "app",
				type: "redeploy",
				recoverMissingImage: true,
			}),
		);
	});
	it("skips active or waiting deployments", async () => {
		mocks.jobs.mockResolvedValue([{ data: { applicationId: "app" } }]);
		await recoverMissingImages();
		expect(mocks.eligible).not.toHaveBeenCalled();
		expect(mocks.add).not.toHaveBeenCalled();
	});
	it("does not enqueue an ineligible application", async () => {
		mocks.eligible.mockResolvedValue(false);
		await recoverMissingImages();
		expect(mocks.add).not.toHaveBeenCalled();
	});
	it("continues checking other applications after a Docker error", async () => {
		mocks.applications.mockResolvedValue([
			{ applicationId: "bad" },
			{ applicationId: "good" },
		]);
		mocks.eligible.mockRejectedValueOnce(new Error("unreachable"));
		await recoverMissingImages();
		expect(mocks.add).toHaveBeenCalledOnce();
		expect(mocks.add.mock.calls[0]?.[1].applicationId).toBe("good");
	});
	it("does not overlap scans", async () => {
		let finish!: (apps: unknown[]) => void;
		mocks.applications.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const first = recoverMissingImages();
		await recoverMissingImages();
		expect(mocks.applications).toHaveBeenCalledOnce();
		finish([]);
		await first;
	});
});
