import React from 'react';
import { useEffect, useState } from 'react';
import Item from '../components/Item';
import { Link } from 'react-router-dom';
import '../CSS/ListPage.css';
import { useActiveSelection } from "../context/selectionContext";

function Items() {
    const [items, setItems] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [searchedItems, setSearchedItems] = useState([]);
    const { activeSelection, setActiveSelection, clearActiveSelection, serverUrl } = useActiveSelection();
    const [isWorking, setIsWorking] = useState(false);
    const [selections, setSelections] = useState(null);
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [classFilter, setClassFilter] = useState('All');





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
                    console.log(selectionData);
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
                // Sort by createdAt date in descending order (null or undefined are last)
                const sortedItems = data.sort((a, b) => {
                    return new Date(b.createdAt) - new Date(a.createdAt);
                });


                setItems(sortedItems);
                setSearchedItems(sortedItems);

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
        setIsWorking(true);

        // Create a new selection object
        let updatedItems;

        if (isAdding) {
            // Add the item with count: 1 if not already present
            updatedItems = [...(selections.items || []), { _id: item._id, count: 1 }];
        } else {
            // Remove the item entirely
            updatedItems = (selections.items || []).filter((obj) => obj._id !== item._id);
        }

        const newSelection = {
            ...selections,
            items: updatedItems,
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
                        body: JSON.stringify(newSelection), // Sends the serialized items
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

        var filteredItems = items;

        if (categoryFilter !== 'All') {
            filteredItems = items.filter((item) => item.category === categoryFilter);
        }

        if (classFilter !== 'All') {
            filteredItems = filteredItems.filter((item) => item.class === classFilter);
        }


        console.log('Filtered Items:', categoryFilter);
        if (search != '') {
            setSearchedItems(
                filteredItems.filter((item) => {
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
            setSearchedItems(filteredItems);
        }
        console.log('Searched Items:', search);
    }, [categoryFilter, items, search, classFilter]);



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
            <div className='filters'>
                <div className='filter-container'>
                    <label>Category:</label>
                    <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                    >
                        <option key='All' value='All'>
                            All
                        </option>
                        {
                            items.map((item) => item.category).filter((value, index, self) => self.indexOf(value) === index).map((category) => (
                                <option key={category} value={category}>
                                    {category}
                                </option>
                            ))
                        }
                    </select>
                    {categoryFilter != 'All' && <button onClick={() => setCategoryFilter('All')}>X</button>}

                </div>
                <div className='filter-container'>
                    <label>Class:</label>
                    <select
                        value={classFilter}
                        onChange={(e) => setClassFilter(e.target.value)}
                    >
                        <option key='All' value='All'>
                            All
                        </option>
                        {
                            items.map((item) => item.class).filter((value, index, self) => self.indexOf(value) === index).map((classType) => (
                                <option key={classType} value={classType}>
                                    {classType}
                                </option>
                            ))
                        }
                    </select>
                    {classFilter != 'All' && <button onClick={() => setClassFilter('All')}>X</button>}
                </div>
            </div>
            <Link className='link button' to="/items/new">Add New item</Link>
            <div className='items-container-list'>
                {searchedItems.length === 0 && <p>No items found.</p>}
                {searchedItems.map((item) => (
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
