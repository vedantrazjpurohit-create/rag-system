import fitz

from app.extract import extract_upload_text


def test_extract_plain_text():
    raw = b"Hello RAG world"
    assert extract_upload_text(raw, "notes.txt") == "Hello RAG world"


def test_extract_pdf_text():
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "ArUco markers are used for camera pose estimation.")
    raw = doc.tobytes()
    doc.close()

    text = extract_upload_text(raw, "paper.pdf")
    assert "ArUco" in text