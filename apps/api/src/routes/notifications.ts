import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@govflow/core';
import { ApiError } from '../lib/api-error.js';
import { handler } from '../lib/async-handler.js';
import { ok } from '../lib/respond.js';
import { authenticate } from '../middleware/auth.js';
import { validateQuery } from '../middleware/validate.js';

export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

const querySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/**
 * Polled by the UI. WebSockets would add a second transport and a second
 * failure mode for no demo benefit at this scale.
 */
notificationsRouter.get(
  '/',
  validateQuery(querySchema),
  handler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof querySchema>;
    const where = {
      userId: req.user!.id,
      ...(query.unreadOnly === 'true' ? { readAt: null } : {}),
    };

    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        include: {
          application: { select: { id: true, applicationNumber: true } },
        },
      }),
      prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
    ]);

    return ok(res, {
      unreadCount,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
        application: n.application,
      })),
    });
  }),
);

notificationsRouter.patch(
  '/:id/read',
  handler(async (req, res) => {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id!, userId: req.user!.id },
    });
    if (!notification) throw ApiError.notFound('Notification not found');

    const updated = await prisma.notification.update({
      where: { id: notification.id },
      data: { readAt: notification.readAt ?? new Date() },
    });
    return ok(res, { id: updated.id, readAt: updated.readAt?.toISOString() ?? null });
  }),
);

notificationsRouter.post(
  '/read-all',
  handler(async (req, res) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok(res, { marked: result.count });
  }),
);
