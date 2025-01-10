import React , {useState, useEffect} from "react";
import axios from "axios";
import { useParams } from "react-router-dom";
import ListModel from "../components/ListModel";
import "../CSS/ShowSelection.css";

const ShowSelection = () => {

    const { id } = useParams();

    //Fetch selection data
    const [selection, setSelection] = useState(null);

    useEffect(() => {
        axios.get(`http://localhost:5000/selects/${id}`)
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

        </div>
    );
};

export default ShowSelection;