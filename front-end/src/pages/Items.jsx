import React from 'react';
import { useEffect, useState } from 'react';
import Item from '../components/Item';
import { data, Link } from 'react-router-dom';
import '../CSS/ListPage.css';
import { useActiveSelection } from "../components/selectionContext";

function Items() {
    const [items, setItems] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filteredItems, setFilteredItems] = useState([]);
    const { activeSelection, setActiveSelection,clearActiveSelection, serverUrl } = useActiveSelection();

    const [isWorking, setIsWorking] = useState(false);
    const [selections, setSelections] = useState(null);



    useEffect(() => {
        const fetchActiveSelection = async () => {
            try {
                const savedSelectionId = document.cookie
                    .split("; ")
                    .find((row) => row.startsWith("activeSelectionId="))
                    ?.split("=")[1];
    
                if (savedSelectionId) {
                    const response = await fetch(`${serverUrl}/api/selections/${savedSelectionId}`);
                    if (!response.ok) {
                        throw new Error('Failed to fetch active selection');
                    }
                    const selectionData = await response.json();
                    setActiveSelection(selectionData._id);
                    return selectionData; // Return the fetched active selection
                }
                return null; // No active selection found
            } catch (error) {
                console.error('Error fetching active selection:', error);
                setError(error.message);
                return null;
            }
        };
    
        const fetchItems = async (activeSelection) => {
            try {
                const response = await fetch(serverUrl + '/api/items');
                if (!response.ok) {
                    throw new Error('Failed to fetch items');
                }
                const data = await response.json();
                // Sort by category
                const sortedItems = data.sort((a, b) => a.category.localeCompare(b.category));
                setItems(sortedItems);
                setFilteredItems(sortedItems);
    
                console.log('Active Selection:', activeSelection);
                console.log('Selections:', selections);
    
                // Set selections if it’s null and active selection is available
                if (selections === null && activeSelection) {
                    console.log('Setting active selection:', activeSelection);
                    setSelections(activeSelection);
                }
            } catch (error) {
                setError(error.message);
            }
        };
    
        const initializeData = async () => {
            setLoading(true);
            const activeSelectionData = await fetchActiveSelection(); // Wait for active selection
            await fetchItems(activeSelectionData); // Pass active selection to fetchItems
            setLoading(false); // Set loading to false after both operations complete
        };
    
        initializeData();
    }, [selections]);

    const handleAddRemoveFromSelection = (isAdding, item) => {

        if (!selections) {
            console.error('No active selection to add to');
            return
        }
        console.log(isAdding ? 'Adding model' : 'Deleting', item);
        console.log('Active Selection:', selections);
        setIsWorking(true);

        // Create a new selection object
        const newSelection = {
            ...selections,
            items: isAdding
                ? [...(selections.items || []), item._id]
                : (selections.items || []).filter((itemId) => itemId !== item._id),
        };

        // Update the active selection
        setSelections(newSelection);

        // Update the backend
        const updateSelection = async () => {
            try {
                const response = await fetch(
                    `${serverUrl}/api/selections/${selections._id}`,
                    {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(newSelection),
                    }
                );

                if (!response.ok) {
                    throw new Error('Failed to update selection');
                }

                console.log('Selection updated successfully');
                setIsWorking(false);

            } catch (err) {
                setError(err.message);
            }
        };

        updateSelection();


    };


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


    if (loading && items === null) {
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
                    <Item key={item._id} item={item} handleClickItem={(property) => {
                        setSearch(property);
                    }}
                        _handleAddRemoveModel={handleAddRemoveFromSelection}
                        isWorking={isWorking}
                    />
                ))}
            </div>
        </div>
    );
}

export default Items;
