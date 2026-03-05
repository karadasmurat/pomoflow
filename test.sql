CREATE TABLE countries (
    country_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE -- Prevents duplicate country codes
);

CREATE TABLE cities (
    city_id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    country_id INTEGER NOT NULL, 
    FOREIGN KEY (country_id) REFERENCES countries(country_id) 
        ON DELETE CASCADE -- If a country is deleted, its cities are also deleted
);

CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    dept_name TEXT NOT NULL,
    -- Self-referencing FK: Points back to the same table
    parent_dept_id INTEGER, 
    -- Tracking when the department was created
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Prevents departments from being their own parent
    CHECK (parent_dept_id <> id),
    FOREIGN KEY (parent_dept_id) REFERENCES departments(id) 
        ON DELETE CASCADE
);