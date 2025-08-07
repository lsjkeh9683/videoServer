const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');

const dbPath = path.join(__dirname, '../../database/media.db');

// 데이터베이스 디렉토리 생성
fs.ensureDirSync(path.dirname(dbPath));

const db = new sqlite3.Database(dbPath);

// 데이터베이스 테이블 생성
db.serialize(() => {
  // 비디오 파일 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      title TEXT,
      file_path TEXT NOT NULL UNIQUE,
      file_size INTEGER,
      duration INTEGER,
      width INTEGER,
      height INTEGER,
      thumbnail_path TEXT,
      preview_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 태그 테이블
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#007bff',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 비디오-태그 연결 테이블 (다대다 관계)
  db.run(`
    CREATE TABLE IF NOT EXISTS video_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE,
      UNIQUE(video_id, tag_id)
    )
  `);

  // 사용자 활동 로그 (시청 기록 등)
  db.run(`
    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
    )
  `);

  // 인덱스 생성
  db.run('CREATE INDEX IF NOT EXISTS idx_videos_filename ON videos(filename)');
  db.run('CREATE INDEX IF NOT EXISTS idx_videos_title ON videos(title)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)');
  db.run('CREATE INDEX IF NOT EXISTS idx_video_tags_video_id ON video_tags(video_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_video_tags_tag_id ON video_tags(tag_id)');

  console.log('✅ Database tables created successfully!');
  
  // 기본 태그 데이터 삽입
  const defaultTags = [
    { name: 'Movie', color: '#dc3545' },
    { name: 'TV Show', color: '#28a745' },
    { name: 'Documentary', color: '#ffc107' },
    { name: 'Animation', color: '#6f42c1' },
    { name: 'Comedy', color: '#fd7e14' },
    { name: 'Drama', color: '#20c997' },
    { name: 'Action', color: '#e83e8c' },
    { name: 'Horror', color: '#6c757d' }
  ];

  const stmt = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
  defaultTags.forEach(tag => {
    stmt.run(tag.name, tag.color);
  });
  stmt.finalize();

  console.log('✅ Default tags inserted!');
});

db.close((err) => {
  if (err) {
    console.error('❌ Error closing database:', err.message);
  } else {
    console.log('✅ Database setup completed successfully!');
  }
});