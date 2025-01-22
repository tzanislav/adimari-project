import React, { useState, useEffect } from 'react';

const Filter = ({ items, filterKey, onFilterChange }) => {
    const [filterValue, setFilterValue] = useState('All');
    const [filteredItems, setFilteredItems] = useState(items);

    useEffect(() => {
        if (filterValue === 'All') {
            setFilteredItems(items);
        } else {
            setFilteredItems(items.filter((item) => item[filterKey] === filterValue));
        }
    }, [filterValue, items, filterKey]);

    // Notify parent component about the filtered items
    useEffect(() => {
        onFilterChange(filteredItems);
    }, [filteredItems, onFilterChange]);

    const uniqueValues = ['All', ...new Set(items.map((item) => item[filterKey]))];

    return (
        <div className="filters">
            <div className="filter-container">
                <label>Filter by {filterKey}:</label>
                <select
                    value={filterValue}
                    onChange={(e) => setFilterValue(e.target.value)}
                >
                    {uniqueValues.map((value) => (
                        <option key={value} value={value}>
                            {value}
                        </option>
                    ))}
                </select>
                {filterValue !== 'All' && (
                    <button onClick={() => setFilterValue('All')}>Clear</button>
                )}
            </div>
        </div>
    );
};

export default Filter;
