import React, { useState, useEffect } from "react";
import { useAuth } from '../context/AuthContext';
import LicenseForm from '../components/LicenseEntryForm';
import LicenseEntry from "../components/LicenseEntry";

function Licenses() {

    const { user, role } = useAuth();

    const [licenses, setLicenses] = useState(null);
    const [filteredLicenses, setFilteredLicenses] = useState(null);
    const [currentLicense, setCurrentLicense] = useState(null);
    const [showEdit, setShowEdit] = useState(false);
    const [number, setNumber] = useState(0);

    if (!user || (role !== 'admin' && role !== 'moderator')) {
        // Redirect to login page
        window.location.href = '/signup';
    }

    useEffect(() => {
        const fetchData = async () => {
            const token = await user.getIdToken();
            try {
                const response = await fetch(import.meta.env.VITE_SERVER_URL + '/api/licenses', {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
                const data = await response.json();
                //Sort by platform
                data.sort((a, b) => a.platform.localeCompare(b.platform));
                if (role === 'admin') {
                    setLicenses(data);
                    setFilteredLicenses(data);
                }
                else {
                    setLicenses(data.filter(license => license.clearances !== 'admin'));
                    setFilteredLicenses(data.filter(license => license.clearances !== 'admin'));
                }
            } catch (error) {
                console.error('Error fetching data:', error);
            }
        };

        fetchData();
    }, [number]);



    const handleEdit = (entry) => {
        console.log(entry);
        setCurrentLicense(entry);
        setShowEdit(true);
    };

    const handleClose = () => {
        setShowEdit(false);
    }



    const handleRefresh = () => {
        setNumber(number + 1);
    };

    if (!licenses) {
        return <div>Loading...</div>
    }


    return (
        <div className="licenses">
            <div className="license-header">
                <h1>Usernames and Passwords</h1>
                <button onClick={() => handleEdit(false)}>Add New Entry</button>
            </div>

            <div className="license-container">
                <div className="search-container">
                    <input type="text" className="search-box" placeholder="Search by username, used by, platform or comment" onChange={(e) => {
                        const search = e.target.value.toLowerCase();
                        setFilteredLicenses(licenses.filter(license =>
                            license.user.toLowerCase().includes(search) ||
                            license.usedBy.toLowerCase().includes(search) ||
                            license.platform.toLowerCase().includes(search) ||
                            license.comment.toLowerCase().includes(search)
                        ));
                    }
                    } />
                </div>
                <table>
                    <tbody>
                        {filteredLicenses.map((license, index) => {


                            return (

                                <React.Fragment key={license._id}>
                                    {index === 0 || filteredLicenses[index - 1].platform !== license.platform ? (
                                        <>
                                            <tr>
                                                <td colSpan="8" className="platform-header">{license.platform}</td>
                                            </tr>

                                            <tr>
                                                <th>Username</th>
                                                <th>Password</th>
                                                <th>Used By</th>
                                                <th>Price</th>
                                                <th>Comment</th>
                                                <th>Expires At</th>
                                                <th>Edit</th>
                                            </tr>

                                        </>
                                    ) : null}
                                    <LicenseEntry entry={license} handleEdit={handleEdit} />

                                </React.Fragment>
                            );
                        })}

                    </tbody>
                </table>
            </div>

            <div className="license-form">
                {showEdit &&
                    <>
                        <div className="overlay"></div>
                        <LicenseForm handleRefresh={handleRefresh} id={currentLicense._id} handleClose={handleClose} />
                    </>
                }
            </div>
        </div>
    );
}


export default Licenses;