import os
import uuid

from fastapi import UploadFile

def save_file(
    file:UploadFile,
    destination:str
):

    os.makedirs(destination,exist_ok=True)

    file_extension = file.filename.split(".")[-1]

    unique_filename = (
        f"{uuid.uuid4()}.{file_extension}"
    )

    file_path = os.path.join(
        destination,
        unique_filename
    )

    with open(file_path,"wb") as buffer:
        buffer.write(file.file.read())

    return file_path