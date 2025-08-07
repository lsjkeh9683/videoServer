// 데이터베이스 초기화 스크립트
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs-extra');

const dbPath = path.join(__dirname, 'database/media.db');
const thumbnailDir = path.join(__dirname, 'thumbnails');
const uploadsDir = path.join(__dirname, 'uploads');

async function clearDatabase() {
  console.log('🗑️  Clearing database and files...');
  
  try {
    // 데이터베이스 초기화
    const db = new sqlite3.Database(dbPath);
    
    await new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('DELETE FROM videos', (err) => {
          if (err) {
            console.error('❌ Error clearing videos:', err);
            reject(err);
          } else {
            console.log('✅ Videos table cleared');
          }
        });
        
        db.run('DELETE FROM video_tags', (err) => {
          if (err) {
            console.error('❌ Error clearing video_tags:', err);
            reject(err);
          } else {
            console.log('✅ Video_tags table cleared');
          }
        });
        
        db.run('DELETE FROM tags WHERE name NOT IN ("Movie", "TV Show", "Documentary", "Animation", "Comedy", "Drama", "Action", "Horror")', (err) => {
          if (err) {
            console.error('❌ Error clearing custom tags:', err);
            reject(err);
          } else {
            console.log('✅ Custom tags cleared (default tags kept)');
          }
        });
        
        db.run('DELETE FROM activity_logs', (err) => {
          if (err) {
            console.error('❌ Error clearing activity_logs:', err);
          } else {
            console.log('✅ Activity logs cleared');
          }
          resolve();
        });
      });
    });
    
    db.close();
    
    // 썸네일 파일들 삭제
    if (await fs.pathExists(thumbnailDir)) {
      const files = await fs.readdir(thumbnailDir);
      for (const file of files) {
        if (file !== '.gitkeep') {
          await fs.remove(path.join(thumbnailDir, file));
        }
      }
      console.log('✅ Thumbnails cleared');
    }
    
    // 업로드 파일들 삭제 (선택사항)
    if (await fs.pathExists(uploadsDir)) {
      const files = await fs.readdir(uploadsDir);
      for (const file of files) {
        if (file !== '.gitkeep') {
          await fs.remove(path.join(uploadsDir, file));
        }
      }
      console.log('✅ Uploaded files cleared');
    }
    
    console.log('🎉 Database and files cleared successfully!');
    console.log('👉 You can now restart the server and upload fresh content.');
    
  } catch (error) {
    console.error('❌ Error clearing database:', error.message);
    console.log('💡 Make sure the server is stopped before running this script.');
  }
}

// 스크립트 실행
clearDatabase();