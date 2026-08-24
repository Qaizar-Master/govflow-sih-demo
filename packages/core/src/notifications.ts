import { NotificationType, type Role } from '@govflow/contracts';
import { prisma } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('notifications');

export interface NotifyInput {
  userId: string;
  applicationId?: string | null;
  type?: NotificationType;
  title: string;
  message: string;
}

export async function notifyUser(input: NotifyInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        applicationId: input.applicationId ?? null,
        type: (input.type ?? NotificationType.INFO) as never,
        title: input.title,
        message: input.message,
      },
    });
  } catch (error) {
    log.warn('failed to create notification', {
      userId: input.userId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/** Notifies the citizen who owns an application, if they have a login. */
export async function notifyApplicant(
  applicationId: string,
  title: string,
  message: string,
  type: NotificationType = NotificationType.INFO,
): Promise<void> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { citizen: { select: { user: { select: { id: true } } } } },
  });
  const userId = application?.citizen.user?.id;
  if (!userId) return;
  await notifyUser({ userId, applicationId, title, message, type });
}

/** Fans a message out to every officer (and admin) - used for exceptions. */
export async function notifyRole(
  roles: Role[],
  title: string,
  message: string,
  applicationId?: string | null,
  type: NotificationType = NotificationType.WARNING,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { role: { in: roles as never } },
    select: { id: true },
  });
  await Promise.all(
    users.map((u) =>
      notifyUser({ userId: u.id, applicationId: applicationId ?? null, title, message, type }),
    ),
  );
}
