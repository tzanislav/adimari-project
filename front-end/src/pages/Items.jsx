import React from 'react';
import { useEffect, useState } from 'react';
import Item from '../components/Item';
import { Link } from 'react-router-dom';
import '../CSS/ListPage.css';

function Items() {
    const [items, setItems] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filteredItems, setFilteredItems] = useState([]);




    useEffect(() => {
        const fetchitems = async () => {
            try {
                const response = await fetch('http://adimari-tzani:5000/items');
                if (!response.ok) {
                    throw new Error('Failed to fetch items');
                }
                const data = await response.json();
                setItems(data);
                setFilteredItems(data);
                //Sort by category
                const sortedItems = data.sort((a, b) => a.category.localeCompare(b.category));
                setItems(sortedItems);

            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchitems();
    }, []);


    useEffect(() => {

        if (search != '') {
            setFilteredItems(
                items.filter((item) => {
                    const searchLower = search.toLowerCase();

                    // Define fields to search
                    const fieldsToSearch = [
                        'name',
                        'item',
                        'brand',
                        'distributor',
                        'description',
                        'website',
                        'class',
                        'category',
                        'location',
                        'personToContact',
                        'email',
                        'phone',
                    ];

                    // Check if any field matches
                    const matchesFields = fieldsToSearch.some((field) =>
                        item[field]?.toLowerCase().includes(searchLower)
                    );

                    // Check if tags array includes the search term
                    const matchesTags = item.tags?.some((tag) =>
                        tag.toLowerCase().includes(searchLower)
                    );

                    return matchesFields || matchesTags;
                })
            );
        }
        else {
            setFilteredItems(items);
        }

    }, [search]);


    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error: {error}</p>;
    }

    return (
        <div className="items-container">
                <h1>Items</h1>
            <div className="search-container">
                <input className='search-box' type="text" placeholder="Search Items" value={search} onChange={(e) => setSearch(e.target.value)} />
                {search != "" ? (<button className='search-button' onClick={() => setSearch('')}>Clear</button>) : null}
            </div>
            <Link className='link button' to="/items/new">Add New item</Link>
            <div className='items-container-list'>
                {filteredItems.length === 0 && <p>No items found.</p>}
                {filteredItems.map((item) => (
                    <Item key={item._id} itemId={item._id} handleClickItem={(property) => {
                        setSearch(property);
                    }} />
                ))}
            </div>
        </div>
    );
}

export default Items;
