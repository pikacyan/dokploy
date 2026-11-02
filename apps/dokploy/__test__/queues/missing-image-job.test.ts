import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	eligible: vi.fn(),
	status: vi.fn(),
	rebuild: vi.fn(),
}));
vi.mock("@dokploy/server", () => ({
	updateApplicationStatus: mocks.status,
	rebuildApplication: mocks.rebuild,
	deployApplication: vi.fn(),
	deployCompose: vi.fn(),
	deployPreviewApplication: vi.fn(),
	rebuildCompose: vi.fn(),
	rebuildPreviewApplication: vi.fn(),
	updateCompose: vi.fn(),
	updatePreviewDeployment: vi.fn(),
}));
vi.mock("@dokploy/server/utils/docker/missing-image", () => ({
	canRecoverMissingImage: mocks.eligible,
}));

import { processDeploymentJob } from "../../server/queues/deployments-queue";
import type { InMemoryJob } from "../../server/queues/in-memory-queue";

const job = {
	data: {
		applicationId: "app",
		applicationType: "application",
		type: "redeploy",
		titleLog: "Recover missing image",
		descriptionLog: "Missing",
		recoverMissingImage: true,
	},
} as InMemoryJob;
beforeEach(() => {
	vi.resetAllMocks();
});
describe("automatic recovery queue guard", () => {
	it("does not rebuild or change status if the app was stopped or repaired while waiting", async () => {
		mocks.eligible.mockResolvedValue(false);
		await processDeploymentJob(job);
		expect(mocks.rebuild).not.toHaveBeenCalled();
		expect(mocks.status).not.toHaveBeenCalled();
	});
	it("runs the existing rebuild path for an eligible recovery", async () => {
		mocks.eligible.mockResolvedValue(true);
		await processDeploymentJob(job);
		expect(mocks.status).toHaveBeenCalledWith("app", "running");
		expect(mocks.rebuild).toHaveBeenCalledWith({
			applicationId: "app",
			titleLog: "Recover missing image",
			descriptionLog: "Missing",
		});
	});
	it("leaves manually requested rebuilds unaffected", async () => {
		await processDeploymentJob({
			...job,
			data: { ...job.data, recoverMissingImage: false },
		} as InMemoryJob);
		expect(mocks.eligible).not.toHaveBeenCalled();
		expect(mocks.rebuild).toHaveBeenCalledOnce();
	});
});
