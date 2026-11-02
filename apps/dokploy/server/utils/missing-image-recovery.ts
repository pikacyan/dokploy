import { db } from "@dokploy/server/db";
import {
	canRecoverMissingImage,
	MISSING_IMAGE_REBUILD_TITLE,
} from "@dokploy/server/utils/docker/missing-image";
import { scheduledJobs, scheduleJob } from "node-schedule";
import { myQueue } from "../queues/queueSetup";

let running = false;
export async function recoverMissingImages() {
	if (running) return;
	running = true;
	try {
		const applications = await db.query.applications.findMany({
			columns: { applicationId: true, serverId: true },
			where: (table, { and, eq, ne }) =>
				and(
					eq(table.applicationStatus, "done"),
					ne(table.sourceType, "docker"),
				),
		});
		const jobs = await myQueue.getJobs(["waiting", "active"]);
		for (const app of applications) {
			try {
				if (
					jobs.some(
						(job) =>
							"applicationId" in job.data &&
							job.data.applicationId === app.applicationId,
					) ||
					!(await canRecoverMissingImage(app.applicationId))
				)
					continue;
				await myQueue.add("deployments", {
					applicationId: app.applicationId,
					applicationType: "application",
					type: "redeploy",
					titleLog: MISSING_IMAGE_REBUILD_TITLE,
					descriptionLog:
						"Swarm reported No such image. Rebuilding existing source once.",
					server: !!app.serverId,
					serverId: app.serverId ?? undefined,
					recoverMissingImage: true,
				});
			} catch {
				console.error("Missing-image recovery failed", app.applicationId);
			}
		}
	} finally {
		running = false;
	}
}

export function initMissingImageRecovery() {
	if (!scheduledJobs["missing-image-recovery"])
		scheduleJob("missing-image-recovery", "* * * * *", () =>
			recoverMissingImages().catch(() =>
				console.error("Missing-image recovery scan failed"),
			),
		);
}
