import React, { useState, useEffect } from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import ListModel from "../components/ListModel";
import "../CSS/ShowSelection.css";
import { useActiveSelection } from "../components/selectionContext";

const ShowSelection = () => {

    const { id } = useParams();

    //Fetch selection data
    const [selection, setSelection] = useState(null);
    const [totalPrice, setTotalPrice] = useState(0);
    const [brandsUsed, setBrandsUsed] = useState([]);
    const { serverUrl } = useActiveSelection();


    useEffect(() => {
        if (selection) {
            const total = selection.detailedModels.reduce((sum, model) => sum + model.price, 0);
            setTotalPrice(total);

            const brands = selection.detailedModels.map((model) => model.brand);
            setBrandsUsed([...new Set(brands)]);

        }
    }, [selection]);

    useEffect(() => {
        axios.get(`${serverUrl}/api/selects/${id}`)
            .then((response) => {
                setSelection(response.data);
            })
            .catch((error) => {
                console.error(error);
            });
    }
        , [id]);

    if (!selection) {
        return <div>Loading...</div>;
    }

    return (
        <div className="show-selection">
            <h1>{selection.name}</h1>
            {selection.detailedModels.map((model) => (
                <ListModel key={model._id} model={model} />
            ))}
            <div className="show-selection-summary">
                <div className="show-selection-brands">
                    <p>Brands Used:</p>
                    <hr />
                    <ul>
                        {brandsUsed.map((brand) => (
                            <li key={brand}>{brand}</li>
                        ))}
                    </ul>
                </div>
                <div className="show-selection-total">
                    <p>Total Price:</p>
                    <hr />
                    <h1>{totalPrice} EUR</h1>
                </div>

            </div>

        </div>
    );
};

export default ShowSelection;