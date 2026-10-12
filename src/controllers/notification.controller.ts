import { Request, Response } from 'express';
import { sendSMSNotification, recentSMSLogs } from '../services/sms.service';
import { prisma } from '../config/db';

/**
 * @route POST /api/notifications/test-sms
 * @desc  Send a test SMS or WhatsApp notification to verify host's phone
 */
export const sendTestSMS = async (req: Request, res: Response) => {
  try {
    const { phone, channel = 'SMS' } = req.body;

    let targetPhone = phone;
    if (!targetPhone && req.user) {
      const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
      targetPhone = user?.phone || '+94771234567';
    }

    if (!targetPhone) {
      targetPhone = '+94771234567';
    }

    const testMessage = `✅ Ceylon Stays: Test ${channel} notification successfully delivered to your verified host number! You will receive instant booking alerts here.`;

    const result = await sendSMSNotification({
      toPhone: targetPhone,
      message: testMessage,
      channel: channel === 'WHATSAPP' ? 'WHATSAPP' : 'SMS',
    });

    return res.status(200).json({
      success: true,
      message: `${channel} alert dispatched successfully!`,
      delivery: result.log,
    });
  } catch (error: any) {
    console.error('Send Test SMS Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to dispatch SMS' });
  }
};

/**
 * @route GET /api/notifications/logs
 * @desc  Retrieve recent SMS notification dispatch logs
 */
export const getNotificationLogs = async (req: Request, res: Response) => {
  try {
    return res.status(200).json({
      count: recentSMSLogs.length,
      logs: recentSMSLogs,
    });
  } catch (error) {
    console.error('Get Notification Logs Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
