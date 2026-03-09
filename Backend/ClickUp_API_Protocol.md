1. Sending a GET to https://api.clickup.com/api/v2/team/{team_Id}/time_entries?assignee={member_id} returns JSON in this format:

{
  "data": [
    {
      "id": "string",
      "task": {
        "id": "string",
        "name": "string",
        "status": {
          "status": "string",
          "color": "string",
          "type": "string",
          "orderindex": "number"
        },
        "custom_type": "number | null"
      },
      "wid": "string",
      "user": {
        "id": "number",
        "username": "string",
        "email": "string",
        "color": "string",
        "initials": "string",
        "profilePicture": "string"
      },
      "billable": "boolean",
      "start": "string",
      "end": "string",
      "duration": "string",
      "description": "string",
      "tags": [],
      "source": "string",
      "at": "string",
      "is_locked": "boolean",
      "approval_id": "null | string | number",
      "task_location": {
        "list_id": "string",
        "folder_id": "string",
        "space_id": "string"
      },
      "task_url": "string"
    }
  ]
}

2. Sending a GET to https://api.clickup.com/api/v2/task/{task_id} returns JSON in this format:

{
  "id": "string",
  "custom_id": "string | null",
  "custom_item_id": "number",
  "name": "string",
  "text_content": "string",
  "description": "string",
  "status": {
    "id": "string",
    "status": "string",
    "color": "string",
    "orderindex": "number",
    "type": "string"
  },
  "orderindex": "string",
  "date_created": "string",
  "date_updated": "string",
  "date_closed": "string | null",
  "date_done": "string | null",
  "archived": "boolean",
  "creator": {
    "id": "number",
    "username": "string",
    "color": "string",
    "email": "string",
    "profilePicture": "string | null"
  },
  "assignees": [
    {
      "id": "number",
      "username": "string",
      "color": "string",
      "initials": "string",
      "email": "string",
      "profilePicture": "string | null"
    }
  ],
  "group_assignees": [],
  "watchers": [
    {
      "id": "number",
      "username": "string",
      "color": "string",
      "initials": "string",
      "email": "string",
      "profilePicture": "string | null"
    }
  ],
  "checklists": [],
  "tags": [],
  "parent": "string | null",
  "top_level_parent": "string | null",
  "priority": "string | null | object",
  "due_date": "string | null",
  "start_date": "string | null",
  "points": "number | null",
  "time_estimate": "number | null",
  "time_spent": "number",
  "custom_fields": [
    {
      "id": "string",
      "name": "string",
      "type": "string",
      "type_config": "object",
      "date_created": "string",
      "hide_from_guests": "boolean",
      "value": "any",
      "value_richtext": "string",
      "required": "boolean"
    }
  ],
  "dependencies": [],
  "linked_tasks": [],
  "locations": [],
  "team_id": "string",
  "url": "string",
  "sharing": {
    "public": "boolean",
    "public_share_expires_on": "string | null",
    "public_fields": ["string"],
    "token": "string | null",
    "seo_optimized": "boolean"
  },
  "permission_level": "string",
  "list": {
    "id": "string",
    "name": "string",
    "access": "boolean"
  },
  "project": {
    "id": "string",
    "name": "string",
    "hidden": "boolean",
    "access": "boolean"
  },
  "folder": {
    "id": "string",
    "name": "string",
    "hidden": "boolean",
    "access": "boolean"
  },
  "space": {
    "id": "string"
  },
  "attachments": [
    {
      "id": "string",
      "date": "string",
      "title": "string",
      "type": "number",
      "source": "number",
      "version": "number",
      "extension": "string",
      "thumbnail_small": "string | null",
      "thumbnail_medium": "string | null",
      "thumbnail_large": "string | null",
      "is_folder": "boolean | null",
      "mimetype": "string",
      "hidden": "boolean",
      "parent_id": "string",
      "size": "number",
      "total_comments": "number",
      "resolved_comments": "number",
      "user": {
        "id": "number",
        "username": "string",
        "email": "string",
        "initials": "string",
        "color": "string",
        "profilePicture": "string | null"
      },
      "deleted": "boolean",
      "orientation": "string | null",
      "url": "string",
      "email_data": "object | null",
      "workspace_id": "string | null",
      "url_w_query": "string",
      "url_w_host": "string"
    }
  ]
}

3. Sending a GET to https://api.clickup.com/api/v2/space/{team_Id}/member returns:

{
  "members": [
    {
      "id": "number",
      "username": "string",
      "email": "string",
      "color": "string",
      "initials": "string",
      "profilePicture": "string | null",
      "profileInfo": {
        "display_profile": "boolean | null",
        "verified_ambassador": "boolean | null | string | number",
        "verified_consultant": "boolean | null | string | number",
        "top_tier_user": "boolean | null | string | number",
        "ai_expert": "boolean | null | string | number",
        "viewed_verified_ambassador": "boolean | null | string | number",
        "viewed_verified_consultant": "boolean | null | string | number",
        "viewed_top_tier_user": "boolean | null | string | number",
        "viewed_ai_expert": "boolean | null | string | number"
      }
    }
  ]
}

4. Sending a GET to https://api.clickup.com/api/v2/folder/{folder_id} returns:

{
  "id": "string",
  "name": "string",
  "orderindex": "number",
  "override_statuses": "boolean",
  "hidden": "boolean",
  "space": {
    "id": "string",
    "name": "string",
    "access": "boolean"
  },
  "task_count": "string | number",
  "archived": "boolean",
  "statuses": [
    {
      "id": "string",
      "status": "string",
      "orderindex": "number",
      "color": "string",
      "type": "string"
    }
  ],
  "deleted": "boolean",
  "lists": [
    {
      "id": "string",
      "name": "string",
      "orderindex": "number",
      "status": "string | null | object",
      "priority": "string | null | object",
      "assignee": "string | null | object",
      "task_count": "number | string",
      "due_date": "string | null",
      "start_date": "string | null",
      "archived": "boolean",
      "override_statuses": "boolean",
      "statuses": [
        {
          "id": "string",
          "status": "string",
          "orderindex": "number",
          "color": "string",
          "type": "string",
          "status_group": "string"
        }
      ],
      "permission_level": "string"
    }
  ],
  "permission_level": "string"
}



Communication with the ClickUp api requires an Authorization key and the value is in the backend .env under CLICKUP_API_KEY
The team id is also in the .env under CLICKUP_TEAM_ID