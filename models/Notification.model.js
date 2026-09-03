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
      isRead: !!row.is_read,
      readAt: row.read_at,
      createdAt: row.created_at,
    };
  }
}

module.exports = Notification;
