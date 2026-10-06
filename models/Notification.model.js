const { toAbsoluteMediaUrl } = require('../helpers/mediaUrl');

class Notification {
  static fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      clubId: row.club_id,
      type: row.type,
      title: row.title,
      message: row.message,
      link: row.link,
      imageUrl: row.image_url ? toAbsoluteMediaUrl(row.image_url) : null,
      isRead: !!row.is_read,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }
}

module.exports = Notification;
