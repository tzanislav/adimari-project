import React from 'react';
import { useEffect, useState } from 'react';
import Brand from '../components/Brand';
import { Link } from 'react-router-dom';
import { useActiveSelection } from "../context/selectionContext";


function Brands() {
    const [brands, setBrands] = useState([]);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [filteredBrands, setFilteredBrands] = useState([]);
    const {serverUrl} = useActiveSelection();
    
    


    useEffect(() => {
        const fetchBrands = async () => {
            try {
                const response = await fetch(serverUrl +'/api/brands');
                if (!response.ok) {
                    throw new Error('Failed to fetch brands');
                }
                const data = await response.json();
                setBrands(data);
                setFilteredBrands(data);
            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchBrands();
    }, []);


    useEffect(() => {

        if (search != '') {
            setFilteredBrands(
                brands.filter((brand) => {
                    const searchLower = search.toLowerCase();

                    // Define fields to search
                    const fieldsToSearch = [
                        'name',
                        'description',
                        'website',
                        'class',
                        'category',
                        'distributor',
                        'location',
                        'personToContact',
                        'email',
                        'phone',
                    ];

                    // Check if any field matches
                    const matchesFields = fieldsToSearch.some((field) =>
                        brand[field]?.toLowerCase().includes(searchLower)
                    );

                    // Check if tags array includes the search term
                    const matchesTags = brand.tags?.some((tag) =>
                        tag.toLowerCase().includes(searchLower)
                    );

                    return matchesFields || matchesTags;
                })
            );
        }
        else {
            setFilteredBrands(brands);
        }

    }, [search]);


    if (loading) {
        return <p>Loading...</p>;
    }

    if (error) {
        return <p>Error: {error}</p>;
    }

    return (
        <div className="brands">
            <h1>Brands Page</h1>
            <input className='search-box' type="text" placeholder="Search Brands" value={search}  onChange={(e) => setSearch(e.target.value)} />
            {search != "" ? (<button className='search-button' onClick={() => setSearch('')}>Clear</button>) : null}
            <Link className='link button' to="/api/brands/new">Add New Brand</Link>
            {filteredBrands.length === 0 && <p>No brands found.</p>}
            {filteredBrands.map((brand) => (
                <Brand key={brand._id} brandId={brand._id} handleClickItem={(property) => {
                    setSearch(property);
                }}/>
            ))}
        </div>
    );
}

export default Brands;
