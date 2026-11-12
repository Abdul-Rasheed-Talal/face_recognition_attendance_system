import sqlite3, os

DB_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'attendance.db')

def migrate():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute('PRAGMA foreign_keys=off;')
    cur.execute('BEGIN TRANSACTION;')
    # Rename existing table
    cur.execute('ALTER TABLE students RENAME TO students_old;')
    # Recreate students table with email nullable
    cur.execute('''
        CREATE TABLE students (
            id TEXT PRIMARY KEY,
            roll_number TEXT UNIQUE NOT NULL,
            full_name TEXT NOT NULL,
            email TEXT,
            department_id TEXT NOT NULL,
            class_id TEXT NOT NULL,
            status TEXT DEFAULT 'ACTIVE',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(department_id) REFERENCES departments(id) ON DELETE RESTRICT,
            FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE RESTRICT
        );
    ''')
    # Copy data back
    cur.execute('''
        INSERT INTO students (id, roll_number, full_name, email, department_id, class_id, status, created_at)
        SELECT id, roll_number, full_name, email, department_id, class_id, status, created_at FROM students_old;
    ''')
    cur.execute('DROP TABLE students_old;')
    cur.execute('COMMIT;')
    cur.execute('PRAGMA foreign_keys=on;')
    conn.close()
    print('Email column migration completed')

if __name__ == '__main__':
    migrate()

