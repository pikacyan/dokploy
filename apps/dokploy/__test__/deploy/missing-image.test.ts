import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	inspect: vi.fn(),
	tasks: vi.fn(),
	docker: vi.fn(),
	application: vi.fn(),
}));
vi.mock("@dokploy/server/db", () => ({
	db: { query: { applications: { findFirst: mocks.application } } },
}));
vi.mock("@dokploy/server/utils/servers/remote-docker", () => ({
	getRemoteDocker: mocks.docker,
}));

import {
	canRecoverMissingImage,
	MISSING_IMAGE_REBUILD_TITLE,
} from "@dokploy/server/utils/docker/missing-image";

const app = {
	appName: "app",
	serverId: null,
	sourceType: "github",
	applicationStatus: "done",
	deployments: [],
};
const task = (
	state = "rejected",
	error = "No such image: app:latest",
	ago = 0,
) => ({
	CreatedAt: new Date(Date.now() - ago).toISOString(),
	Spec: { ContainerSpec: { Image: "app:latest" } },
	Status: { State: state, Err: error },
});
beforeEach(() => {
	vi.resetAllMocks();
	mocks.docker.mockResolvedValue({
		getService: () => ({ inspect: mocks.inspect }),
		listTasks: mocks.tasks,
	});
	mocks.inspect.mockResolvedValue({
		ID: "service",
		Spec: {
			Mode: { Replicated: { Replicas: 1 } },
			TaskTemplate: { ContainerSpec: { Image: "app:latest" } },
		},
	});
	mocks.tasks.mockResolvedValue([task()]);
	mocks.application.mockResolvedValue(app);
});

describe("missing-image recovery eligibility", () => {
	it("detects a current No such image rejection", async () => {
		expect(await canRecoverMissingImage("id")).toBe(true);
	});
	it.each(["idle", "running", "error"])(
		"ignores %s applications",
		async (applicationStatus) => {
			mocks.application.mockResolvedValue({ ...app, applicationStatus });
			expect(await canRecoverMissingImage("id")).toBe(false);
			expect(mocks.docker).not.toHaveBeenCalled();
		},
	);
	it("uses the latest deployment record to prevent another automatic attempt", async () => {
		mocks.application.mockResolvedValue({
			...app,
			deployments: [{ title: MISSING_IMAGE_REBUILD_TITLE }],
		});
		expect(await canRecoverMissingImage("id")).toBe(false);
		mocks.application.mockResolvedValue({
			...app,
			deployments: [{ title: "Manual deployment" }],
		});
		expect(await canRecoverMissingImage("id")).toBe(true);
	});
	it("skips registry-only apps and unconfigured remote servers", async () => {
		for (const override of [
			{ sourceType: "docker" },
			{ serverId: "remote", server: null },
		]) {
			mocks.application.mockResolvedValue({ ...app, ...override });
			expect(await canRecoverMissingImage("id")).toBe(false);
		}
		expect(mocks.docker).not.toHaveBeenCalled();
	});
	it("ignores zero replicas and any remaining running replica", async () => {
		mocks.tasks.mockResolvedValue([task(), task("running", "")]);
		expect(await canRecoverMissingImage("id")).toBe(false);
		mocks.inspect.mockResolvedValue({
			Spec: { Mode: { Replicated: { Replicas: 0 } } },
		});
		expect(await canRecoverMissingImage("id")).toBe(false);
	});
	it("ignores ordinary crashes and older rejected tasks", async () => {
		mocks.tasks.mockResolvedValue([task("failed", "task: non-zero exit (1)")]);
		expect(await canRecoverMissingImage("id")).toBe(false);
		mocks.tasks.mockResolvedValue([
			task("rejected", "No such image: app:latest", 1000),
			task("preparing", ""),
		]);
		expect(await canRecoverMissingImage("id")).toBe(false);
	});
	it("does not recover a rejection for a previous image", async () => {
		mocks.tasks.mockResolvedValue([
			{ ...task(), Spec: { ContainerSpec: { Image: "old-image" } } },
		]);
		expect(await canRecoverMissingImage("id")).toBe(false);
	});
	it("ignores an application deleted while queued", async () => {
		mocks.application.mockResolvedValue(undefined);
		expect(await canRecoverMissingImage("id")).toBe(false);
	});
});
