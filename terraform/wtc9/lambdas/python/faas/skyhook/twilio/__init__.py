from hashlib import sha1
from json import loads

from aws_lambda_powertools.utilities.data_classes import SQSRecord

from ... import SNS, _, chan, dump_json
from ...twilio import parse_params, verify
from .. import TRACER


def proc_twilio(record: SQSRecord) -> bool:
    match record.raw_event:
        case {
            "messageAttributes": {
                "RawURL": {"stringValue": str(uri)},
                "Signature": {"stringValue": str(signature)},
            }
        }:
            params = parse_params(record.body)
        case _:
            return False

    with TRACER.start_as_current_span("verify hmac"):
        if not verify(uri, params=params, signature=signature):
            return False

    match params:
        case {"PayloadType": "application/json", "Payload": str(payload)}:
            params["Payload"] = loads(payload)
        case _:
            return False

    json = dump_json(params)
    hashed = sha1(json.encode()).hexdigest()

    SNS.publish(TopicArn=chan(), Subject=f"/twilio/error - {hashed}", Message=json)
    return True
