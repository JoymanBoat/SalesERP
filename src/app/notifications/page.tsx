import Link from "next/link";

import { WorkspaceShell } from "@/components/workspace-shell";
import { markNotificationRead } from "@/app/notifications/actions";
import { getVisibleNotificationTypes } from "@/lib/permissions";
import { getWorkspace } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export default async function NotificationsPage() {
  const { session, membership, organization, store, activeStores } = await getWorkspace({ operation: "view" });
  const notifications = await prisma.inAppNotification.findMany({
    where: {
      organizationId: organization.id,
      membershipId: membership.id,
      storeId: { in: activeStores.map(({ id }) => id) },
      type: { in: getVisibleNotificationTypes(membership.role) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      title: true,
      body: true,
      href: true,
      type: true,
      createdAt: true,
      readAt: true,
      store: { select: { name: true } },
    },
  });

  return (
    <WorkspaceShell
      activeSection="notifications"
      membershipId={membership.id}
      organizationId={organization.id}
      currency={organization.currency}
      organizationName={organization.name}
      role={membership.role}
      storeId={store.id}
      storeName={store.name}
      userName={session.user.name ?? session.user.email ?? "User"}
    >
      <header className="workspace-header">
        <div>
          <p className="breadcrumbs">Workspace / Notifications</p>
          <h1>Notifications</h1>
          <p className="header-note">Operational reminders and daily sales summaries for your assigned stores.</p>
        </div>
      </header>
      <section className="data-panel notification-list" aria-label="Your notifications">
        {notifications.length === 0 ? (
          <p className="empty-state">You’re all caught up. New operational reminders will appear here.</p>
        ) : notifications.map((notification) => (
          <article className={`notification-item${notification.readAt ? "" : " unread"}`} key={notification.id}>
            <div className="notification-copy">
              <div className="notification-heading">
                <h2>{notification.title}</h2>
                {!notification.readAt && <span className="notification-unread-label">New</span>}
              </div>
              <p>{notification.body}</p>
              <small>
                {notification.store.name} · {notification.createdAt.toLocaleString("en-GH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: organization.timezone,
                })}
              </small>
            </div>
            <div className="notification-actions">
              <Link className="report-export-link" href={notification.href}>Open</Link>
              {!notification.readAt && (
                <form action={markNotificationRead}>
                  <input name="notificationId" type="hidden" value={notification.id} />
                  <button className="button-quiet" type="submit">Mark as read</button>
                </form>
              )}
            </div>
          </article>
        ))}
      </section>
    </WorkspaceShell>
  );
}
